// Loads Leaflet and the marker cluster plugin. The plugin extends the global
// `L` object, so Leaflet has to be available as `window.L` before the plugin
// module is evaluated. ES modules are evaluated in import order, so this
// module must be imported before 'leaflet.markercluster'.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

(window as unknown as {L: typeof L}).L = L;

export default L;
