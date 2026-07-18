namespace com.yury.ordermgmt;

using { cuid, managed } from '@sap/cds/common';

entity Customers : cuid, managed {
  name    : String(100) @mandatory;
  email   : String(100);
  country : String(2);
  orders  : Association to many Orders on orders.customer = $self;
}

entity Products : cuid, managed {
  name        : String(100) @mandatory;
  description : String(500);
  price       : Decimal(9,2) @mandatory;
  stock       : Integer default 0;
}

entity Orders : cuid, managed {
  customer    : Association to Customers @mandatory;
  orderDate   : Date @mandatory;
  status      : String(20) enum { DRAFT; SUBMITTED; SHIPPED; CANCELLED } default 'DRAFT';
  totalAmount : Decimal(9,2);
  items       : Composition of many OrderItems on items.order = $self;
}

entity OrderItems : cuid {
  order    : Association to Orders;
  product  : Association to Products @mandatory;
  quantity : Integer @mandatory default 1;
  price    : Decimal(9,2);
}
