/**
 * Logger standardisé avec préfixe module.
 */
export const createLogger = (moduleName) => ({
  log: (...args) => console.log(`[${moduleName}]`, ...args),
  warn: (...args) => console.warn(`[${moduleName}]`, ...args),
  error: (...args) => console.error(`[${moduleName}]`, ...args)
});
