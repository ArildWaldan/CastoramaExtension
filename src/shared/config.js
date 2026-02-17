/**
 * Configuration partagée de Casto Tools.
 */
export const CONFIG = {
  STORE_CODE: '1502',
  TENANT_ID: 'CAFR',
  OPERATING_COMPANY: 'CF01',
  STORE_NAME: 'Castorama Jouy-aux-Arches',
  STORE_PHONE: '03 XX XX XX XX',
  STORE_EMAIL: 'metz2.menuiserie@castorama.fr',
  MANAGER_ID: 'ARNAUD.DERHAN@CASTORAMA.FR',
  GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbx6wfRJB2Qay_4g6Ms6NdxVEet9C-LoXya52j35s8g/dev',
  COLIWEB_USERNAME: 'castometz012',
  COLIWEB_PASSWORD: 'cw12',
  COLIWEB_CLIENT_ID: '249',
  COLIWEB_STORE_ID: '8481',
  STORE_LAT: 49.0750948,
  STORE_LON: 6.1000448,
  STORE_POSTAL: '57130',
  GEOCODE_API_KEY: '65ae97aa4417a328160769gcb8adb4f',
  EEG_SERVER: 'http://eegserver1502.frca.kfplc.com:3333',
  EEG_DEFAULT_FLASH_DURATION: 1800,
  GEV_CACHE_TTL_MS: 172800000
};

export const STORAGE_KEYS = {
  COLIWEB_LAST_ESTIMATE: 'coliweb.lastEstimate',
  GEV_CACHE: 'gev.cache',
  GEV_REBUILD_LOCK: 'gev.rebuildLock',
  SUR_MESURE_LAST: 'surMesure.last',
  PROVISIONNES_LAST: 'provisionnes.last'
};
