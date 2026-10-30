import cds from '@sap/cds/eslint.config.mjs'
export default [
  { ignores: ['gen/**', 'mta_archives/**', '.deploy/**', 'app/orders/dist/**', '**/node_modules/**'] },
  ...cds.recommended
]
