import cds from '@sap/cds'

const { SELECT, UPDATE } = cds.ql
const LOG = cds.log('order-service')

const round2 = n => Math.round(n * 100) / 100

export default class OrderService extends cds.ApplicationService {
  async init() {
    const { Orders, OrderItems, Products, Customers, BusinessPartners } = this.entities

    // ------------------------------------------------------------------
    // 1. Draft editing: items get price from product, stock check,
    //    netAmount and a live totalAmount on the draft header.
    //
    //    Lean draft (CAP 8+): while the user edits in Fiori, events arrive on
    //    <Entity>.drafts as NEW / PATCH / DELETE — not CREATE / UPDATE.
    //    NB: a plain req.error() is downgraded to a warning during draft PATCH
    //    (request still returns 200), so use req.reject() for a hard stop.
    //    The same check is repeated on activation — stock may change meanwhile.
    // ------------------------------------------------------------------
    this.before(['NEW', 'PATCH'], OrderItems.drafts, async req => {
      // NB: handlers are registered for 'PATCH', but in CAP 10 req.event is 'UPDATE' here
      const current = req.event === 'NEW' ? {} : await SELECT.one.from(OrderItems.drafts, req.data.ID)
      const item = { ...current, ...req.data }
      if (!item.product_ID) return

      const product = await SELECT.one.from(Products, item.product_ID)
      if (!product) return req.reject({ status: 404, message: `Product ${item.product_ID} not found`, target: 'product_ID' })

      const quantity = item.quantity ?? 1
      if (quantity > product.stock) {
        return req.reject({
          status: 409, target: 'quantity',
          message: `Cannot order ${quantity} × "${product.name}" — only ${product.stock} in stock`
        })
      }
      req.data.price = product.price
      req.data.netAmount = round2(quantity * product.price)
    })

    // remember the parent before the draft item disappears
    this.before('DELETE', OrderItems.drafts, async req => {
      const row = await SELECT.one.from(OrderItems.drafts, req.data.ID).columns('order_ID')
      req._orderID = row?.order_ID
    })

    this.after(['NEW', 'PATCH', 'DELETE'], OrderItems.drafts, async (result, req) => {
      const orderID = req._orderID ?? result?.order_ID
        ?? (await SELECT.one.from(OrderItems.drafts, req.data.ID).columns('order_ID'))?.order_ID
      if (orderID) await this._recalcDraftTotal(orderID)
    })

    // ------------------------------------------------------------------
    // 2. Activation (Save button): lean draft runs CREATE (new order) or
    //    UPDATE (edited order) on the ACTIVE entity with the full deep document.
    //    This is the authoritative place for totals — fixes the old TODO,
    //    which tried to use after('SAVE') and never fired.
    // ------------------------------------------------------------------
    this.before(['CREATE', 'UPDATE'], Orders, async req => {
      const order = req.data
      if (!order.items) return // header-only update, items untouched

      if (!order.items.length) return req.error({ status: 400, message: 'An order needs at least one item', target: 'items' })

      const ids = order.items.map(i => i.product_ID)
      const products = await SELECT.from(Products).where({ ID: { in: ids } })
      const byID = Object.fromEntries(products.map(p => [p.ID, p]))

      let total = 0
      for (const [i, item] of order.items.entries()) {
        const p = byID[item.product_ID]
        if (!p) { req.error({ status: 404, message: `Product ${item.product_ID} not found`, target: `items[${i}]/product_ID` }); continue }
        if ((item.quantity ?? 1) > p.stock) {
          req.error({ status: 409, message: `Cannot order ${item.quantity} × "${p.name}" — only ${p.stock} in stock`, target: `items[${i}]/quantity` })
          continue
        }
        item.price = p.price
        item.netAmount = round2((item.quantity ?? 1) * p.price)
        total += item.netAmount
        order.currency_code ??= p.currency_code
      }
      order.totalAmount = round2(total)
    })

    this.before('CREATE', Orders, async req => {
      // fixed-width number => max() on the string is also the numeric max
      const { max } = await SELECT.one.from(Orders).columns('max(orderNo) as max')
      const next = (max ? Number(max.slice(2)) : 0) + 1
      req.data.orderNo = 'SO' + String(next).padStart(6, '0')
      req.data.status_code = 'NEW'
    })

    // only NEW orders may be edited or deleted
    this.before(['EDIT', 'DELETE'], Orders, async req => {
      const { ID } = req.params.at(-1) ?? req.data
      const order = await SELECT.one.from(Orders, ID).columns('status_code', 'orderNo')
      if (order && order.status_code !== 'NEW') {
        req.reject(409, `Order ${order.orderNo} is ${order.status_code} and can no longer be changed`)
      }
    })

    // ------------------------------------------------------------------
    // 3. Bound actions = RAP "actions" with status-dependent availability
    // ------------------------------------------------------------------
    this.on('submit', Orders, async req => {
      const { ID } = req.params[0]
      const order = await this._getActiveOrder(req, ID, ['NEW'])
      const items = await SELECT.from(OrderItems).where({ order_ID: ID })
      if (!items.length) return req.reject(400, 'An order needs at least one item')

      // reserve stock atomically: the WHERE stock >= qty guard protects against
      // two users submitting the last units at the same time
      for (const item of items) {
        const affected = await UPDATE(Products, item.product_ID)
          .with({ stock: { '-=': item.quantity } })
          .where('stock >=', item.quantity)
        if (!affected) {
          const p = await SELECT.one.from(Products, item.product_ID)
          return req.reject(409, `Not enough stock for "${p.name}" (${p.stock} left, ${item.quantity} needed)`)
        }
      }
      await UPDATE(Orders, ID).with({ status_code: 'SUBMITTED' })
      LOG.info(`Order ${order.orderNo} submitted by ${req.user.id}`)
      return SELECT.one.from(Orders, ID)
    })

    this.on('cancel', Orders, async req => {
      const { ID } = req.params[0]
      const order = await this._getActiveOrder(req, ID, ['NEW', 'SUBMITTED'])

      if (order.status_code === 'SUBMITTED') { // release reserved stock
        const items = await SELECT.from(OrderItems).where({ order_ID: ID })
        for (const item of items) {
          await UPDATE(Products, item.product_ID).with({ stock: { '+=': item.quantity } })
        }
      }
      await UPDATE(Orders, ID).with({ status_code: 'CANCELLED', cancellationReason: req.data.reason })
      return SELECT.one.from(Orders, ID)
    })

    this.on('ship', Orders, async req => {
      const { ID } = req.params[0]
      await this._getActiveOrder(req, ID, ['SUBMITTED'])
      await UPDATE(Orders, ID).with({ status_code: 'SHIPPED' })
      return SELECT.one.from(Orders, ID)
    })

    // ------------------------------------------------------------------
    // 4. Remote S/4HANA Business Partner API via Destination service
    //    (mocked locally from srv/external/data/*.csv)
    // ------------------------------------------------------------------
    this.on('READ', BusinessPartners, async req => {
      const bupa = await cds.connect.to('API_BUSINESS_PARTNER')
      return bupa.run(req.query)
    })

    this.before(['CREATE', 'UPDATE'], Customers, async req => {
      const bp = req.data.s4BusinessPartner
      if (!bp) return
      const bupa = await cds.connect.to('API_BUSINESS_PARTNER')
      const partner = await bupa.run(
        SELECT.one.from('API_BUSINESS_PARTNER.A_BusinessPartner')
          .columns('BusinessPartner', 'BusinessPartnerIsBlocked')
          .where({ BusinessPartner: bp })
      )
      if (!partner) return req.error({ status: 400, message: `Business partner ${bp} does not exist in S/4HANA`, target: 's4BusinessPartner' })
      if (partner.BusinessPartnerIsBlocked) return req.error({ status: 400, message: `Business partner ${bp} is blocked in S/4HANA`, target: 's4BusinessPartner' })
    })

    return super.init()
  }

  async _getActiveOrder(req, ID, allowedStatus) {
    const order = await SELECT.one.from(this.entities.Orders, ID)
    if (!order) return req.reject(404, `Order ${ID} not found`)
    if (!allowedStatus.includes(order.status_code)) {
      return req.reject(409, `Action not allowed: order ${order.orderNo} is ${order.status_code}`)
    }
    return order
  }

  async _recalcDraftTotal(orderID) {
    const { Orders, OrderItems } = this.entities
    const { total } = await SELECT.one.from(OrderItems.drafts)
      .columns('sum(netAmount) as total')
      .where({ order_ID: orderID })
    await UPDATE(Orders.drafts, orderID).with({ totalAmount: round2(total ?? 0) })
  }
}
