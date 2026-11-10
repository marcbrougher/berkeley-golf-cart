# 🐻 GolfBear

A class-project prototype of an on-demand golf cart ride service around UC Berkeley.

**Live demo:** https://marcbrougher.github.io/berkeley-golf-cart/

> This is a proof of concept. **No real golf carts are dispatched.**

## What it does

- Shows a map of Berkeley with the 2.5-mile service zone around Sather Tower
- Lets you set a pickup spot by sharing your location, typing an address, or tapping the map
- Rejects pickups outside the zone
- Lets you choose 1–5 riders
- "Send a GolfBear" pops up a confirmation, then the nearest cart drives to you along real streets with a live ETA

## How it's built

A static HTML/CSS/JavaScript site hosted on GitHub Pages, with no server and no API keys:

- [Leaflet](https://leafletjs.com/) with [OpenStreetMap](https://www.openstreetmap.org/) map tiles
- [Nominatim](https://nominatim.org/) for address lookup
- [OSRM](https://project-osrm.org/) demo server for the cart's street route (falls back to a straight line)
