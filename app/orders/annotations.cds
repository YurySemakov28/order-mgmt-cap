using OrderService as service from '../../srv/order-service';

// ---------------------------------------------------------------------------
// Orders — List Report + Object Page
// ---------------------------------------------------------------------------
annotate service.Orders with @(
  UI.HeaderInfo         : {
    TypeName      : '{i18n>Order}',
    TypeNamePlural: '{i18n>Orders}',
    Title         : { Value: orderNo },
    Description   : { Value: customer.name }
  },
  UI.SelectionFields    : [ customer_ID, status_code, orderDate ],
  UI.LineItem           : [
    { Value: orderNo,     Label: '{i18n>OrderNo}' },
    { Value: customer_ID, Label: '{i18n>Customer}' },
    { Value: orderDate,   Label: '{i18n>OrderDate}' },
    { Value: status_code, Label: '{i18n>Status}', Criticality: status.criticality },
    { Value: totalAmount, Label: '{i18n>TotalAmount}' },
    { $Type: 'UI.DataFieldForAction', Action: 'OrderService.submit', Label: '{i18n>Submit}' },
    { $Type: 'UI.DataFieldForAction', Action: 'OrderService.ship',   Label: '{i18n>Ship}' }
  ],
  UI.HeaderFacets       : [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#status' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#total' }
  ],
  UI.DataPoint #status  : { Value: status_code, Title: '{i18n>Status}', Criticality: status.criticality },
  UI.DataPoint #total   : { Value: totalAmount, Title: '{i18n>TotalAmount}' },
  UI.Identification     : [
    { $Type: 'UI.DataFieldForAction', Action: 'OrderService.submit', Label: '{i18n>Submit}' },
    { $Type: 'UI.DataFieldForAction', Action: 'OrderService.ship',   Label: '{i18n>Ship}' },
    { $Type: 'UI.DataFieldForAction', Action: 'OrderService.cancel', Label: '{i18n>Cancel}' }
  ],
  UI.FieldGroup #General: { Data: [
    { Value: customer_ID },
    { Value: orderDate },
    { Value: currency_code },
    { Value: cancellationReason }
  ]},
  UI.FieldGroup #Admin  : { Data: [
    { Value: createdBy }, { Value: createdAt }, { Value: modifiedBy }, { Value: modifiedAt }
  ]},
  UI.Facets             : [
    { $Type: 'UI.ReferenceFacet', ID: 'General', Label: '{i18n>General}', Target: '@UI.FieldGroup#General' },
    { $Type: 'UI.ReferenceFacet', ID: 'Items',   Label: '{i18n>Items}',   Target: 'items/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'Admin',   Label: '{i18n>Admin}',   Target: '@UI.FieldGroup#Admin' }
  ],
  // RAP-like "feature control": edit/delete/actions only when status allows
  UI.UpdateHidden       : { $edmJson: { $Ne: [ { $Path: 'status_code' }, 'NEW' ] } },
  UI.DeleteHidden       : { $edmJson: { $Ne: [ { $Path: 'status_code' }, 'NEW' ] } },
  // refresh header total when items change in the draft
  Common.SideEffects #items: {
    SourceEntities  : [ items ],
    TargetProperties: [ 'totalAmount' ]
  }
) {
  orderNo     @title: '{i18n>OrderNo}';
  orderDate   @title: '{i18n>OrderDate}';
  totalAmount @title: '{i18n>TotalAmount}' @Measures.ISOCurrency: currency_code;
  cancellationReason @title: '{i18n>CancellationReason}';
  status      @title: '{i18n>Status}' @Common: {
    Text           : status.name,
    TextArrangement: #TextOnly,
    ValueListWithFixedValues
  };
  customer    @title: '{i18n>Customer}' @Common: {
    Text           : customer.name,
    TextArrangement: #TextOnly,
    ValueList      : {
      CollectionPath: 'Customers',
      Parameters    : [
        { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: customer_ID, ValueListProperty: 'ID' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'country_code' }
      ]
    }
  };
};

// Action availability = RAP instance feature control. Actions are hidden in draft mode.
annotate service.Orders actions {
  submit @Core.OperationAvailable: { $edmJson: { $And: [
           { $Path: '_it/IsActiveEntity' },
           { $Eq: [ { $Path: '_it/status_code' }, 'NEW' ] } ] } };
  ship   @Core.OperationAvailable: { $edmJson: { $And: [
           { $Path: '_it/IsActiveEntity' },
           { $Eq: [ { $Path: '_it/status_code' }, 'SUBMITTED' ] } ] } };
  cancel @Core.OperationAvailable: { $edmJson: { $And: [
           { $Path: '_it/IsActiveEntity' },
           { $Or: [
             { $Eq: [ { $Path: '_it/status_code' }, 'NEW' ] },
             { $Eq: [ { $Path: '_it/status_code' }, 'SUBMITTED' ] } ] } ] } }
         (reason @title: '{i18n>CancellationReason}' @UI.MultiLineText);
};

// ---------------------------------------------------------------------------
// Order items (table on the object page)
// ---------------------------------------------------------------------------
annotate service.OrderItems with @(
  UI.HeaderInfo: { TypeName: '{i18n>Item}', TypeNamePlural: '{i18n>Items}', Title: { Value: product.name } },
  UI.LineItem  : [
    { Value: product_ID, Label: '{i18n>Product}' },
    { Value: quantity,   Label: '{i18n>Quantity}' },
    { Value: price,      Label: '{i18n>Price}' },
    { Value: netAmount,  Label: '{i18n>NetAmount}' }
  ],
  Common.SideEffects #qty: {
    SourceProperties: [ quantity, product_ID ],
    TargetProperties: [ 'price', 'netAmount', 'order/totalAmount' ]
  }
) {
  product   @title: '{i18n>Product}' @Common: {
    Text           : product.name,
    TextArrangement: #TextOnly,
    ValueList      : {
      CollectionPath: 'Products',
      Parameters    : [
        { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: product_ID, ValueListProperty: 'ID' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'price' },
        { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'stock' }
      ]
    }
  };
  quantity  @title: '{i18n>Quantity}';
  price     @title: '{i18n>Price}'     @Measures.ISOCurrency: order.currency_code;
  netAmount @title: '{i18n>NetAmount}' @Measures.ISOCurrency: order.currency_code;
};

// ---------------------------------------------------------------------------
// Master data / value helps
// ---------------------------------------------------------------------------
annotate service.Customers with @(
  UI.LineItem: [ { Value: name }, { Value: email }, { Value: country_code }, { Value: s4BusinessPartner } ]
) {
  ID                @UI.Hidden @Common.Text: name;
  name              @title: '{i18n>Customer}';
  email             @title: '{i18n>Email}';
  s4BusinessPartner @title: '{i18n>S4BusinessPartner}' @Common.ValueList: {
    CollectionPath: 'BusinessPartners',
    Parameters    : [
      { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: s4BusinessPartner, ValueListProperty: 'ID' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'blocked' }
    ]
  };
};

annotate service.Products with {
  ID    @UI.Hidden @Common.Text: name;
  name  @title: '{i18n>Product}';
  price @title: '{i18n>Price}' @Measures.ISOCurrency: currency_code;
  stock @title: '{i18n>Stock}';
};

annotate service.OrderStatus with {
  code @Common.Text: name @Common.TextArrangement: #TextOnly;
};

annotate service.BusinessPartners with {
  ID      @title: '{i18n>S4BusinessPartner}';
  name    @title: '{i18n>Name}';
  blocked @title: '{i18n>Blocked}';
};
