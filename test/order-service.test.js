import cds from '@sap/cds'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const { GET, POST, PATCH, DELETE } = cds.test('serve', 'all', '--with-mocks', '--in-memory?').in(import.meta.dirname + '/..')

const svc = '/odata/v4/order'
const alice = { auth: { username: 'alice', password: 'alice' } } // OrderManager
const bob   = { auth: { username: 'bob',   password: 'bob' } }   // OrderViewer
const carol = { auth: { username: 'carol', password: 'carol' } } // no role

const ACME   = 'c0a1b2c3-0001-4000-8000-000000000001'
const SENSOR = 'a0a1b2c3-0002-4000-8000-000000000001' // 89.90, stock 150
const VALVE  = 'a0a1b2c3-0002-4000-8000-000000000002' // 245.50, stock 60
const PLC    = 'a0a1b2c3-0002-4000-8000-000000000003' // 610.00, stock 25
const SUBMITTED_ORDER = 'b0a1b2c3-0003-4000-8000-000000000001'

const expectError = async (promise, status) => {
  await assert.rejects(promise, e => e.response?.status === status || e.status === status || e.code == status)
}

/** create a draft order with items and activate it, like the Fiori "Create" + "Save" flow */
async function createOrder(items) {
  const { data: draft } = await POST(`${svc}/Orders`, { customer_ID: ACME, orderDate: '2026-10-30' }, alice)
  for (const it of items) {
    const { data: item } = await POST(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)/items`, { product_ID: it.product }, alice)
    if (it.quantity) await PATCH(`${svc}/OrderItems(ID=${item.ID},IsActiveEntity=false)`, { quantity: it.quantity }, alice)
  }
  const { data } = await POST(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)/OrderService.draftActivate`, {}, alice)
  return data
}

describe('Authorization', () => {
  it('viewer can read orders', async () => {
    const { status } = await GET(`${svc}/Orders`, bob)
    assert.equal(status, 200)
  })
  it('viewer cannot create orders', async () => {
    await expectError(POST(`${svc}/Orders`, { customer_ID: ACME, orderDate: '2026-10-30' }, bob), 403)
  })
  it('user without role gets 403', async () => {
    await expectError(GET(`${svc}/Orders`, carol), 403)
  })
  it('anonymous gets 401', async () => {
    await expectError(GET(`${svc}/Orders`), 401)
  })
})

describe('Draft editing', () => {
  it('copies price from product and computes netAmount + draft total live', async () => {
    const { data: draft } = await POST(`${svc}/Orders`, { customer_ID: ACME, orderDate: '2026-10-30' }, alice)
    const { data: item } = await POST(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)/items`, { product_ID: VALVE }, alice)
    assert.equal(Number(item.price), 245.5)
    assert.equal(Number(item.netAmount), 245.5)

    await PATCH(`${svc}/OrderItems(ID=${item.ID},IsActiveEntity=false)`, { quantity: 3 }, alice)
    let { data: header } = await GET(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)`, alice)
    assert.equal(Number(header.totalAmount), 736.5)

    await DELETE(`${svc}/OrderItems(ID=${item.ID},IsActiveEntity=false)`, alice)
    ;({ data: header } = await GET(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)`, alice))
    assert.equal(Number(header.totalAmount), 0)
  })

  it('rejects quantity above stock already in the draft', async () => {
    const { data: draft } = await POST(`${svc}/Orders`, { customer_ID: ACME, orderDate: '2026-10-30' }, alice)
    const { data: item } = await POST(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)/items`, { product_ID: PLC }, alice)
    await expectError(PATCH(`${svc}/OrderItems(ID=${item.ID},IsActiveEntity=false)`, { quantity: 26 }, alice), 409)
  })

  it('rejects a product that is out of stock', async () => {
    const REGULATOR = 'a0a1b2c3-0002-4000-8000-000000000004' // stock 0
    const { data: draft } = await POST(`${svc}/Orders`, { customer_ID: ACME, orderDate: '2026-10-30' }, alice)
    await expectError(POST(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)/items`, { product_ID: REGULATOR }, alice), 409)
  })

  it('ignores client-supplied price (read-only field)', async () => {
    const { data: draft } = await POST(`${svc}/Orders`, { customer_ID: ACME, orderDate: '2026-10-30' }, alice)
    const { data: item } = await POST(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)/items`, { product_ID: SENSOR, price: 0.01 }, alice)
    assert.equal(Number(item.price), 89.9)
  })
})

describe('Activation (Save)', () => {
  it('assigns order number, status NEW and recalculates totalAmount (old TODO)', async () => {
    const order = await createOrder([{ product: SENSOR, quantity: 2 }, { product: VALVE }])
    assert.equal(order.status_code, 'NEW')
    assert.match(order.orderNo, /^SO\d{6}$/)
    assert.ok(order.orderNo > 'SO001002')
    assert.equal(Number(order.totalAmount), 425.3)
    assert.equal(order.currency_code, 'EUR')
  })

  it('totalAmount is correct after edit -> change quantity -> save', async () => {
    const order = await createOrder([{ product: SENSOR }])
    await POST(`${svc}/Orders(ID=${order.ID},IsActiveEntity=true)/OrderService.draftEdit`, { PreserveChanges: true }, alice)
    const { data: items } = await GET(`${svc}/Orders(ID=${order.ID},IsActiveEntity=false)/items`, alice)
    await PATCH(`${svc}/OrderItems(ID=${items.value[0].ID},IsActiveEntity=false)`, { quantity: 10 }, alice)
    const { data } = await POST(`${svc}/Orders(ID=${order.ID},IsActiveEntity=false)/OrderService.draftActivate`, {}, alice)
    assert.equal(Number(data.totalAmount), 899)
  })

  it('rejects an order without items', async () => {
    const { data: draft } = await POST(`${svc}/Orders`, { customer_ID: ACME, orderDate: '2026-10-30' }, alice)
    await expectError(POST(`${svc}/Orders(ID=${draft.ID},IsActiveEntity=false)/OrderService.draftActivate`, {}, alice), 400)
  })
})

describe('Actions: submit / ship / cancel', () => {
  const stockOf = async id => (await GET(`${svc}/Products(${id})`, alice)).data.stock

  it('submit reserves stock, cancel releases it', async () => {
    const before = await stockOf(VALVE)
    const order = await createOrder([{ product: VALVE, quantity: 5 }])
    const act = `${svc}/Orders(ID=${order.ID},IsActiveEntity=true)/OrderService`

    const { data: submitted } = await POST(`${act}.submit`, {}, alice)
    assert.equal(submitted.status_code, 'SUBMITTED')
    assert.equal(await stockOf(VALVE), before - 5)

    const { data: cancelled } = await POST(`${act}.cancel`, { reason: 'Customer request' }, alice)
    assert.equal(cancelled.status_code, 'CANCELLED')
    assert.equal(cancelled.cancellationReason, 'Customer request')
    assert.equal(await stockOf(VALVE), before)
  })

  it('submit fails when stock is insufficient and leaves stock unchanged', async () => {
    const o1 = await createOrder([{ product: PLC, quantity: 20 }])
    const o2 = await createOrder([{ product: PLC, quantity: 20 }]) // ok in draft: stock still 25
    await POST(`${svc}/Orders(ID=${o1.ID},IsActiveEntity=true)/OrderService.submit`, {}, alice)
    await expectError(POST(`${svc}/Orders(ID=${o2.ID},IsActiveEntity=true)/OrderService.submit`, {}, alice), 409)
    assert.equal(await stockOf(PLC), 5)
  })

  it('submitted order cannot be edited', async () => {
    await expectError(POST(`${svc}/Orders(ID=${SUBMITTED_ORDER},IsActiveEntity=true)/OrderService.draftEdit`, {}, alice), 409)
  })

  it('ship only from SUBMITTED; shipped order cannot be cancelled', async () => {
    const order = await createOrder([{ product: SENSOR }])
    const act = `${svc}/Orders(ID=${order.ID},IsActiveEntity=true)/OrderService`
    await expectError(POST(`${act}.ship`, {}, alice), 409)
    await POST(`${act}.submit`, {}, alice)
    const { data } = await POST(`${act}.ship`, {}, alice)
    assert.equal(data.status_code, 'SHIPPED')
    await expectError(POST(`${act}.cancel`, { reason: 'too late' }, alice), 409)
  })

  it('viewer cannot run actions', async () => {
    await expectError(POST(`${svc}/Orders(ID=${SUBMITTED_ORDER},IsActiveEntity=true)/OrderService.ship`, {}, bob), 403)
  })
})

describe('S/4HANA Business Partner integration (mocked)', () => {
  it('reads remote business partners through the service projection', async () => {
    const { data } = await GET(`${svc}/BusinessPartners?$filter=blocked eq false`, alice)
    assert.equal(data.value.length, 3)
    assert.ok(data.value.every(bp => bp.name))
  })

  it('accepts a customer linked to an existing BP', async () => {
    const { status } = await POST(`${svc}/Customers`, { name: 'Test AG', country_code: 'DE', s4BusinessPartner: '1000002' }, alice)
    assert.equal(status, 201)
  })

  it('rejects unknown or blocked BP', async () => {
    await expectError(POST(`${svc}/Customers`, { name: 'X', s4BusinessPartner: '9999999' }, alice), 400)
    await expectError(POST(`${svc}/Customers`, { name: 'Y', s4BusinessPartner: '1000004' }, alice), 400)
  })
})
