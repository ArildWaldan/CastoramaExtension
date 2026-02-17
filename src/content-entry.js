/**
 * Point d'entrée content-script qui active les modules selon l'URL courante.
 */
const log = (...args) => console.log('[ContentEntry]', ...args);

const load = (path) => import(chrome.runtime.getURL(path));

(async () => {
  const host = window.location.host;

  if (host === 'dc.kfplc.com') {
    const [{ bootstrapCaddieMagique }, { bootstrapProvisionnes }, { bootstrapGev }] = await Promise.all([
      load('src/modules/caddie-magique/content.js'),
      load('src/modules/provisionnes/content.js'),
      load('src/modules/gev/content.js')
    ]);
    bootstrapCaddieMagique();
    bootstrapProvisionnes();
    bootstrapGev();
  }

  if (host === 'prod-agent.castorama.fr' || host === 'bo.production.colisweb.com' || host === 'agile.intranet.castosav.castorama.fr:8080') {
    const { bootstrapColiweb } = await load('src/modules/coliweb/content.js');
    bootstrapColiweb();
  }

  if (host === 'squareclock-internal-sqc-production.k8s.ap.digikfplc.com') {
    const { bootstrapSurMesure } = await load('src/modules/sur-mesure/content.js');
    bootstrapSurMesure();
  }

  log('Modules chargés pour', host);
})();
