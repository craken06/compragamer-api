/**
 * Instalación y asesoría: el cliente la pide al final del configurador ("Pedir instalación y
 * asesoría") para los equipos de ese sistema. Se cobra como un porcentaje de esos equipos, con
 * los precios de la base (nunca los del navegador). El sitio usa el mismo porcentaje
 * (INSTALLATION_RATE en src/config.js) solo para mostrarla antes de pagar.
 */
export const INSTALLATION_RATE = 0.25;
/** order_items.product_id no tiene FK a products: 0 marca la línea del servicio. */
export const INSTALLATION_PRODUCT_ID = 0;
export const INSTALLATION_NAME = `Instalación y asesoría (${Math.round(INSTALLATION_RATE * 100)} % de los equipos del sistema)`;
/** id del ítem en Mercado Pago */
export const INSTALLATION_MP_ID = 'instalacion';
