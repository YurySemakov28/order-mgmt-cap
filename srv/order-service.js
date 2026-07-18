module.exports = async function () {

  const { Orders, Products } = this.entities;

  // Validation: нельзя заказать больше, чем есть на складе
  this.before(['NEW', 'CREATE'], ['OrderItems', 'OrderItems.drafts'], async (req) => {
    const { product_ID, quantity } = req.data;
    if (!product_ID || !quantity) return;

    const product = await SELECT.one.from(Products).where({ ID: product_ID });

    if (!product) {
      return req.error(404, `Product ${product_ID} not found`);
    }

    if (quantity > product.stock) {
      return req.error(400,
        `Cannot order ${quantity} units of "${product.name}" — only ${product.stock} in stock`
      );
    }
  });

  // TODO: totalAmount recalculation on draft activate — not yet triggered correctly,
  // draftActivate doesn't fire a 'SAVE' event the way expected; needs further investigation
  // into CAP's lean-draft event lifecycle for the root entity.

};