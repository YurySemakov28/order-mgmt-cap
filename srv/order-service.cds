using com.yury.ordermgmt as db from '../db/schema';

service OrderService {

  @odata.draft.enabled
  entity Orders as projection on db.Orders;

  entity OrderItems as projection on db.OrderItems;

  entity Customers as projection on db.Customers;

  @readonly
  entity Products as projection on db.Products;
}