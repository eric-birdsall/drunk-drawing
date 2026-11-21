import { PrecacheController, PrecacheRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { RangeRequestsPlugin } from "workbox-range-requests";

// The registration scope keeps this cache separate from other Pages games.
// Install is atomic: a failed asset download leaves the previous worker active.
const precache = new PrecacheController({
  cacheName: `drunk-drawing-${self.registration.scope}`,
  plugins: [new RangeRequestsPlugin()],
});
precache.precache(self.__WB_MANIFEST);
registerRoute(new PrecacheRoute(precache));

// Deliberately no skipWaiting/clientsClaim: existing windows keep their version.
// Workbox removes superseded entries only when all old clients have closed.
