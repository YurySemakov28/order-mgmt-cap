using com.yury.ordermgmt as db from '../db/schema';
using { API_BUSINESS_PARTNER as bupa } from './external/API_BUSINESS_PARTNER';

/**
 * Roles (become XSUAA scopes / role templates, see xs-security.json):
 *  - OrderViewer  : read everything
 *  - OrderManager : create/edit orders, run actions, maintain customers
 */
@path    : '/odata/v4/order'
@requires: 'authenticated-user'
service OrderService {

  @odata.draft.enabled
  @restrict: [
    { grant: 'READ', to: ['OrderViewer', 'OrderManager'] },
    { grant: '*',    to: 'OrderManager' }
  ]
  entity Orders as projection on db.Orders
    actions {
      @(
        cds.odata.bindingparameter.name: '_it',
        Common.SideEffects             : { TargetProperties: ['_it/status_code'], TargetEntities: ['_it/items'] }
      )
      action submit() returns Orders;

      @(
        cds.odata.bindingparameter.name: '_it',
        Common.SideEffects             : { TargetProperties: ['_it/status_code'] }
      )
      action cancel(reason : String(200) @mandatory) returns Orders;

      @(
        cds.odata.bindingparameter.name: '_it',
        Common.SideEffects             : { TargetProperties: ['_it/status_code'] }
      )
      action ship() returns Orders;
    };

  @restrict: [
    { grant: 'READ', to: ['OrderViewer', 'OrderManager'] },
    { grant: '*',    to: 'OrderManager' }
  ]
  entity OrderItems as projection on db.OrderItems;

  @restrict: [
    { grant: 'READ', to: ['OrderViewer', 'OrderManager'] },
    { grant: '*',    to: 'OrderManager' }
  ]
  entity Customers as projection on db.Customers;

  @readonly
  entity Products as projection on db.Products;

  @readonly
  entity OrderStatus as projection on db.OrderStatus;

  /** Remote S/4HANA business partners (read live via Destination service) */
  @readonly
  @cds.persistence.skip
  entity BusinessPartners as projection on bupa.A_BusinessPartner {
    key BusinessPartner          as ID,
        BusinessPartnerFullName  as name,
        BusinessPartnerCategory  as category,
        BusinessPartnerIsBlocked as blocked
  };
}
