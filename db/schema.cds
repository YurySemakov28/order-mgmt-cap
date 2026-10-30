namespace com.yury.ordermgmt;

using {
  cuid,
  managed,
  Currency,
  Country,
  sap.common.CodeList
} from '@sap/cds/common';
using from '@sap/cds-common-content';

/**
 * Business partner master data (local copy).
 * Optionally linked to an S/4HANA Business Partner via `s4BusinessPartner`
 * (value help comes from the remote API_BUSINESS_PARTNER, see srv/external).
 */
entity Customers : cuid, managed {
  name              : String(100) @mandatory;
  email             : String(100) @assert.format: '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  country           : Country;
  s4BusinessPartner : String(10);
  orders            : Association to many Orders
                        on orders.customer = $self;
}

entity Products : cuid, managed {
  name        : String(100) @mandatory;
  description : String(500);
  price       : Decimal(9, 2) @mandatory;
  currency    : Currency;
  stock       : Integer default 0 @assert.range: [0, 999999];
}

/** Order lifecycle: NEW -> SUBMITTED -> SHIPPED, or -> CANCELLED */
entity OrderStatus : CodeList {
  key code        : String(10);
      criticality : Integer; // 0 neutral, 1 negative, 2 critical, 3 positive (Fiori semantic colors)
}

entity Orders : cuid, managed {
  orderNo     : String(10) @readonly; // SO000001, assigned on first save
  customer    : Association to Customers @mandatory;
  orderDate   : Date @mandatory;
  status      : Association to OrderStatus default 'NEW' @readonly;
  totalAmount : Decimal(11, 2) @readonly;
  currency    : Currency;
  cancellationReason : String(200) @readonly;
  items       : Composition of many OrderItems
                  on items.order = $self;
}

entity OrderItems : cuid {
  order     : Association to Orders;
  product   : Association to Products @mandatory;
  quantity  : Integer @mandatory default 1 @assert.range: [1, 9999];
  price     : Decimal(9, 2) @readonly; // copied from product
  netAmount : Decimal(11, 2) @readonly; // quantity * price
}
