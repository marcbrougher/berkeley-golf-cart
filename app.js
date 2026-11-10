/* GolfBear prototype: no real golf carts are dispatched. */
(() => {
  'use strict';

  // ---------- Config ----------
  const SATHER = L.latLng(37.87207, -122.25779);
  const M_PER_MI = 1609.344;
  const RADIUS_MI = 2.5;
  const RADIUS_M = RADIUS_MI * M_PER_MI;
  const CART_SPEED_MPS = (12 * M_PER_MI) / 3600; // golf carts cruise ~12 mph
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const OSRM = 'https://router.project-osrm.org/route/v1/driving';

  const DEPOTS = [
    { name: 'Sproul Plaza', ll: [37.8697, -122.2594], driver: 'Maya', id: 'GB-03' },
    { name: 'North Gate', ll: [37.8755, -122.2601], driver: 'Oski', id: 'GB-01' },
    { name: 'Downtown Berkeley BART', ll: [37.8701, -122.2681], driver: 'Diego', id: 'GB-15' },
    { name: 'Clark Kerr Campus', ll: [37.8636, -122.2500], driver: 'Sam', id: 'GB-21' },
    { name: 'Elmwood', ll: [37.8578, -122.2527], driver: 'Priya', id: 'GB-12' },
    { name: 'Gourmet Ghetto', ll: [37.8800, -122.2690], driver: 'Jordan', id: 'GB-07' },
    { name: 'Southside', ll: [37.8646, -122.2587], driver: 'Alex', id: 'GB-09' },
  ];

  const SAMPLES = [
    '2220 Piedmont Ave, Berkeley, CA',
    '2150 Shattuck Ave, Berkeley, CA',
    '2650 Durant Ave, Berkeley, CA',
    '2995 College Ave, Berkeley, CA',
  ];

  const CART_SVG = `<svg viewBox="0 0 48 34" aria-hidden="true">
    <rect x="6" y="2" width="34" height="4.5" rx="2" fill="#FDB515" stroke="#003262" stroke-width="1"/>
    <path d="M10.5 6.5V19M35.5 6.5L40 19" stroke="#003262" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="13" y="10" width="5" height="9" rx="1.5" fill="#FDB515"/>
    <path d="M4 19H42a3 3 0 0 1 3 3v4H3v-5.5A1.5 1.5 0 0 1 4 19Z" fill="#003262"/>
    <circle cx="12" cy="27" r="5" fill="#1d1d1f" stroke="#fff" stroke-width="2"/>
    <circle cx="36" cy="27" r="5" fill="#1d1d1f" stroke="#fff" stroke-width="2"/>
  </svg>`;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    requestView: $('requestView'), locate: $('locateBtn'), form: $('addressForm'),
    address: $('address'), find: $('findBtn'), sample: $('sampleBtn'), status: $('status'),
    send: $('sendBtn'), hint: $('sendHint'), cartCount: $('cartCount'),
    trip: $('trip'), tripStatus: $('tripStatus'), tripEta: $('tripEta'), tripEtaWrap: $('tripEtaWrap'),
    tripBar: $('tripBar'), tripDriver: $('tripDriver'), tripCart: $('tripCart'),
    tripRiders: $('tripRiders'), tripSize: $('tripSize'), tripPickup: $('tripPickup'),
    tripBtn: $('tripBtn'), toast: $('toast'), map: $('map'),
  };
  const SEND_LABEL = '🛺 Send a GolfBear';
  els.send.textContent = SEND_LABEL;

  // ---------- Map ----------
  const map = L.map('map', { zoomControl: true, zoomSnap: 0.5 }).setView(SATHER, 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const zone = L.circle(SATHER, {
    radius: RADIUS_M, color: '#FDB515', weight: 3, dashArray: '10 7',
    fillColor: '#003262', fillOpacity: 0.07, interactive: false,
  }).addTo(map);
  const zoneBounds = () => zone.getBounds();
  const fitZone = () => map.fitBounds(zoneBounds(), { padding: [16, 16] });
  fitZone();
  // Keep the whole zone in view if the map is resized before a pickup is set.
  new ResizeObserver(() => {
    map.invalidateSize();
    if (!pickup && !trip) fitZone();
  }).observe(document.getElementById('map'));

  L.marker(SATHER, {
    icon: L.divIcon({ className: '', html: '<div class="tower-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    keyboard: false, interactive: false,
  }).addTo(map).bindTooltip('Sather Tower', { permanent: true, direction: 'top', offset: [0, -10], className: 'tower-label' });

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = `
      <div><span class="lg-zone"></span>2.5 mi GolfBear zone</div>
      <div><span class="lg-cart"><span class="cart">${CART_SVG}</span></span>Available cart</div>
      <div><span class="lg-pin"></span>Your pickup</div>`;
    return div;
  };
  legend.addTo(map);

  function cartIcon(active) {
    const size = active ? 48 : 34;
    return L.divIcon({
      className: '',
      html: `<div class="cart${active ? ' cart-active' : ''}">${CART_SVG}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  const carts = DEPOTS.map((d) => {
    const home = L.latLng(d.ll);
    const marker = L.marker(home, { icon: cartIcon(false), keyboard: false })
      .addTo(map)
      .bindTooltip(`Cart ${d.id} · ${d.driver} · available`, { direction: 'top', offset: [0, -16] });
    return { ...d, home, marker };
  });
  els.cartCount.textContent = carts.length;

  // ---------- State ----------
  let pickup = null; // { latlng, label, inZone, distMi }
  let pickupMarker = null;
  let trip = null;
  let busy = false;
  let sampleIdx = 0;

  const riders = () => Number(document.querySelector('input[name="riders"]:checked').value);
  const fmtMi = (mi) => (mi < 10 ? mi.toFixed(1) : Math.round(mi).toLocaleString());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isPhone = () => window.matchMedia('(max-width: 820px)').matches;

  // ---------- UI helpers ----------
  function setStatus(kind, icon, text) {
    els.status.className = `status ${kind}`;
    els.status.replaceChildren();
    if (!kind) return;
    const i = document.createElement('span');
    i.className = 's-icon';
    i.textContent = icon;
    const t = document.createElement('span');
    t.textContent = text;
    els.status.append(i, t);
  }

  function setBusy(on) {
    busy = on;
    els.locate.disabled = on;
    els.find.disabled = on;
    els.sample.disabled = on;
  }

  async function withBusy(fn) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      setStatus('err', '⚠️', 'Address lookup is unavailable right now. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function updateSend() {
    const n = riders();
    const ready = !!(pickup && pickup.inZone && !trip);
    els.send.disabled = !ready;
    if (!pickup) els.hint.textContent = 'Set a pickup spot to request a cart.';
    else if (!pickup.inZone) els.hint.textContent = 'Pickup must be inside the gold circle.';
    else els.hint.textContent = `Ready: ${n} rider${n > 1 ? 's' : ''} from ${pickup.label}.`;
  }

  let toastTimer;
  function showToast(icon, title, body) {
    const i = document.createElement('div');
    i.className = 'toast-icon';
    i.textContent = icon;
    const txt = document.createElement('div');
    const h = document.createElement('div');
    h.className = 'toast-title';
    h.textContent = title;
    const b = document.createElement('div');
    b.className = 'toast-body';
    b.textContent = body;
    txt.append(h, b);
    els.toast.replaceChildren(i, txt);
    els.toast.hidden = false;
    void els.toast.offsetWidth; // restart the slide-in transition
    els.toast.classList.add('show');
    if (navigator.vibrate) navigator.vibrate(120);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 7000);
  }
  function hideToast() {
    els.toast.classList.remove('show');
    setTimeout(() => { if (!els.toast.classList.contains('show')) els.toast.hidden = true; }, 320);
  }
  els.toast.addEventListener('click', hideToast);

  // ---------- Geocoding (OpenStreetMap Nominatim) ----------
  async function nominatim(path, params) {
    const url = `${NOMINATIM}${path}?${new URLSearchParams({ format: 'jsonv2', addressdetails: 1, 'accept-language': 'en', ...params })}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
    return res.json();
  }

  async function geocode(q) {
    const b = zoneBounds().pad(0.15);
    const viewbox = [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].join(',');
    // Prefer matches near campus, so "2400 Durant Ave" resolves to Berkeley.
    let results = await nominatim('/search', { q, limit: 1, countrycodes: 'us', viewbox, bounded: 1 });
    if (!results.length) {
      await sleep(1100); // Nominatim allows ~1 request per second
      results = await nominatim('/search', { q, limit: 1 });
    }
    return results[0] || null;
  }

  const reverse = (ll) => nominatim('/reverse', { lat: ll.lat.toFixed(6), lon: ll.lng.toFixed(6), zoom: 18 });

  function shortLabel(r) {
    const a = r.address || {};
    const street = [a.house_number, a.road || a.pedestrian || a.footway || a.path].filter(Boolean).join(' ');
    const place = a.city || a.town || a.village || a.hamlet || a.suburb || '';
    const name = r.name && !street.includes(r.name) ? r.name : '';
    const parts = [...new Set([name, street, place].filter(Boolean))];
    return parts.length ? parts.slice(0, 3).join(', ') : r.display_name.split(',').slice(0, 3).join(',');
  }

  // ---------- Pickup ----------
  function setPickup(latlng, label, { fly = true } = {}) {
    const distMi = map.distance(latlng, SATHER) / M_PER_MI;
    const inZone = distMi <= RADIUS_MI;
    pickup = { latlng, label, inZone, distMi };

    const icon = L.divIcon({
      className: '',
      html: `<div class="pin ${inZone ? 'pin-ok' : 'pin-bad'}"><span></span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    if (!pickupMarker) pickupMarker = L.marker(latlng, { icon, zIndexOffset: 1000, keyboard: false }).addTo(map);
    else pickupMarker.setLatLng(latlng).setIcon(icon);
    pickupMarker.unbindTooltip().bindTooltip(label, { direction: 'top', offset: [0, -14] });

    if (inZone) {
      setStatus('ok', '📍', `Pickup set: ${label} (${fmtMi(distMi)} mi from Sather Tower).`);
      if (fly) map.flyTo(latlng, Math.max(map.getZoom(), 16), { duration: 0.8 });
    } else {
      setStatus('err', '🚫', `${label} is ${fmtMi(distMi)} mi from Sather Tower, outside the 2.5 mi GolfBear zone. Try an address inside the gold circle.`);
      if (fly) map.flyToBounds(zoneBounds().extend(latlng), { padding: [40, 40], duration: 0.8 });
    }
    updateSend();
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = els.address.value.trim();
    if (trip) return;
    if (!q) {
      setStatus('err', '✏️', 'Type a pickup address first.');
      els.address.focus();
      return;
    }
    withBusy(async () => {
      setStatus('info', '⏳', 'Looking up that address…');
      const r = await geocode(q);
      if (!r) {
        setStatus('err', '🤔', "Couldn't find that address. Try including the street number and “Berkeley”.");
        return;
      }
      setPickup(L.latLng(+r.lat, +r.lon), shortLabel(r));
    });
  });

  els.sample.addEventListener('click', () => {
    els.address.value = SAMPLES[sampleIdx++ % SAMPLES.length];
    els.form.requestSubmit();
  });

  els.locate.addEventListener('click', () => {
    if (trip || busy) return;
    if (!('geolocation' in navigator)) {
      setStatus('err', '⚠️', "This browser can't share your location. Type your address instead.");
      return;
    }
    setBusy(true);
    setStatus('info', '⏳', 'Finding your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
        let label = 'Your current location';
        try {
          const r = await reverse(ll);
          if (r && !r.error) label = shortLabel(r);
        } catch (_) { /* keep generic label */ }
        els.address.value = label === 'Your current location' ? '' : label;
        setPickup(ll, label);
        setBusy(false);
      },
      (err) => {
        setBusy(false);
        setStatus('err', '⚠️', err.code === 1
          ? 'Location access was blocked. Allow it in your browser, or type your address instead.'
          : "Couldn't get your location. Try typing your address instead.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });

  map.on('click', (e) => {
    if (trip || busy) return;
    withBusy(async () => {
      setStatus('info', '⏳', 'Dropping a pin…');
      let label = 'Dropped pin';
      try {
        const r = await reverse(e.latlng);
        if (r && !r.error) label = shortLabel(r);
      } catch (_) { /* keep generic label */ }
      els.address.value = label === 'Dropped pin' ? '' : label;
      setPickup(e.latlng, label, { fly: false });
    });
  });

  document.querySelectorAll('input[name="riders"]').forEach((r) => r.addEventListener('change', updateSend));

  // ---------- Dispatch ----------
  function nearestCart(ll) {
    return carts.reduce((best, c) => (map.distance(c.home, ll) < map.distance(best.home, ll) ? c : best));
  }

  async function getRoute(a, b) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal: ctrl.signal });
      clearTimeout(timer);
      const j = await res.json();
      if (j.code === 'Ok' && j.routes && j.routes.length) {
        const pts = j.routes[0].geometry.coordinates.map(([lng, lat]) => L.latLng(lat, lng));
        return { points: [a, ...pts, b], meters: j.routes[0].distance };
      }
    } catch (_) { /* fall back to a straight line */ }
    return { points: [a, b], meters: map.distance(a, b) * 1.3 };
  }

  els.send.addEventListener('click', async () => {
    if (!pickup || !pickup.inZone || trip || busy) return;
    const cart = nearestCart(pickup.latlng);
    setBusy(true);
    els.send.disabled = true;
    els.send.textContent = 'Dispatching…';
    const route = await getRoute(cart.home, pickup.latlng);
    setBusy(false);
    startTrip(cart, route, riders());
  });

  function startTrip(cart, route, n) {
    const etaMin = Math.max(2, Math.round(route.meters / CART_SPEED_MPS / 60) + 1);
    const demoMs = Math.min(40000, Math.max(14000, etaMin * 3500)); // sped up for the demo

    const cum = [0];
    for (let i = 1; i < route.points.length; i++) cum.push(cum[i - 1] + route.points[i - 1].distanceTo(route.points[i]));

    const line = L.polyline(route.points, { color: '#003262', weight: 5, opacity: 0.8, dashArray: '1 10', lineCap: 'round' }).addTo(map);
    map.flyToBounds(line.getBounds(), { padding: [70, 70], maxZoom: 17, duration: 0.8 });

    cart.marker.unbindTooltip().setIcon(cartIcon(true)).setZIndexOffset(2000);

    trip = { cart, line, n, etaMin, demoMs, cum, total: cum[cum.length - 1] || 1, pts: route.points, start: 0, raf: 0, arrived: false, pickupLabel: pickup.label };

    els.tripDriver.textContent = cart.driver;
    els.tripCart.textContent = cart.id;
    els.tripRiders.textContent = `${n} rider${n > 1 ? 's' : ''}`;
    els.tripSize.textContent = n <= 3 ? '4-seat cart' : '6-seat cart';
    els.tripPickup.textContent = pickup.label;
    els.tripStatus.textContent = 'On the way';
    els.tripEtaWrap.innerHTML = `<b id="tripEta">${etaMin}</b> min`;
    els.tripEta = $('tripEta');
    els.tripBar.style.width = '0%';
    els.tripBtn.textContent = 'Cancel ride';
    els.tripBtn.classList.remove('done');
    els.trip.classList.remove('arrived');
    els.requestView.hidden = true;
    els.trip.hidden = false;
    els.send.textContent = SEND_LABEL;
    updateSend();

    if (isPhone()) els.map.scrollIntoView({ behavior: 'smooth', block: 'start' });

    showToast('🛺', 'A GolfBear is on the way!', `${cart.driver} is driving cart ${cart.id} to ${pickup.label}. ETA ${etaMin} min.`);
    trip.raf = requestAnimationFrame((t) => { trip.start = t; tick(t); });
  }

  function tick(now) {
    if (!trip || trip.arrived) return;
    const p = Math.min(1, (now - trip.start) / trip.demoMs);
    const d = p * trip.total;
    let i = 1;
    while (i < trip.cum.length - 1 && trip.cum[i] < d) i++;
    const a = trip.pts[i - 1];
    const b = trip.pts[i];
    const seg = trip.cum[i] - trip.cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (d - trip.cum[i - 1]) / seg));
    const pos = L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);

    trip.cart.marker.setLatLng(pos);
    trip.line.setLatLngs([pos, ...trip.pts.slice(i)]);
    const cartEl = trip.cart.marker.getElement() && trip.cart.marker.getElement().querySelector('.cart');
    if (cartEl && Math.abs(b.lng - a.lng) > 1e-6) cartEl.classList.toggle('flip', b.lng < a.lng);

    els.tripBar.style.width = `${(p * 100).toFixed(1)}%`;
    els.tripEta.textContent = Math.max(1, Math.ceil(trip.etaMin * (1 - p)));

    if (p < 1) trip.raf = requestAnimationFrame(tick);
    else arrive();
  }

  function arrive() {
    trip.arrived = true;
    trip.line.remove();
    els.trip.classList.add('arrived');
    els.tripStatus.textContent = 'Arrived';
    els.tripEtaWrap.innerHTML = '<b>Here!</b>';
    els.tripBar.style.width = '100%';
    els.tripBtn.textContent = 'Done: book another ride';
    els.tripBtn.classList.add('done');
    showToast('🐻', 'Your GolfBear has arrived!', `Look for ${trip.cart.driver} in cart ${trip.cart.id}. Hop in, all ${trip.n} of you!`);
  }

  els.tripBtn.addEventListener('click', () => {
    if (!trip) return;
    const { cart, arrived } = trip;
    cancelAnimationFrame(trip.raf);
    trip.line.remove();
    cart.marker
      .setLatLng(cart.home)
      .setIcon(cartIcon(false))
      .setZIndexOffset(0)
      .bindTooltip(`Cart ${cart.id} · ${cart.driver} · available`, { direction: 'top', offset: [0, -16] });
    trip = null;
    els.trip.hidden = true;
    els.requestView.hidden = false;
    if (!arrived) showToast('↩️', 'Ride cancelled', `${cart.driver} is heading back to ${cart.name}.`);
    if (pickup) map.flyTo(pickup.latlng, Math.max(map.getZoom(), 15), { duration: 0.6 });
    updateSend();
  });
})();
