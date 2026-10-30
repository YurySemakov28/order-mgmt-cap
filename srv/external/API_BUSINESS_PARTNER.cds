/*
 * Reduced definition of the SAP S/4HANA Cloud OData V2 API "Business Partner (A2X)"
 * (API_BUSINESS_PARTNER). Only the fields this app uses are kept.
 *
 * Full definition: download the EDMX from https://api.sap.com/api/API_BUSINESS_PARTNER
 * and run `cds import API_BUSINESS_PARTNER.edmx --as cds` to replace this file.
 *
 * - development: CAP serves a mock of this service with data from ./data/*.csv
 * - production:  requests go through the BTP Destination service (destination "S4_BUPA")
 */
@cds.external : true
@m.IsDefaultEntityContainer : 'true'
@sap.supported.formats : 'atom json xlsx'
service API_BUSINESS_PARTNER {

  @cds.external : true
  @cds.persistence.skip : true
  @sap.content.version : '1'
  @sap.label : 'Business Partner'
  entity A_BusinessPartner {
    @sap.label : 'Business Partner'
    key BusinessPartner         : String(10) not null;
    @sap.label : 'Full Name'
    BusinessPartnerFullName     : String(81);
    @sap.label : 'BP Category'
    BusinessPartnerCategory     : String(1);
    @sap.label : 'Grouping'
    BusinessPartnerGrouping     : String(4);
    @sap.label : 'Central Block'
    BusinessPartnerIsBlocked    : Boolean;
    @sap.label : 'Created On'
    CreationDate                : Date;
  };
};
