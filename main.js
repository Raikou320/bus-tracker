const map = L.map("map");
let userLat;
let userLon;
let firstPosition = true;
let userPosMarker;
navigator.geolocation.watchPosition(
  (position) => {
    userLat = position.coords.latitude;
    userLon = position.coords.longitude;
    if (firstPosition) {
      map.setView([userLat, userLon], 15);
      firstPosition = false;
      userPosMarker = L.circleMarker([userLat, userLon], {
        radius: 12,
        weight: 2,
        color: "#FF0000",
        fillColor: "#FF0000",
      }).addTo(map);
    }
    userPosMarker.setLatLng([userLat, userLon]);
  },
  () => {
    userLat = 49.890746;
    userLon = 2.312592;
    if (firstPosition) {
      map.setView([userLat, userLon], 15);
      firstPosition = false;
      userPosMarker = L.circleMarker([userLat, userLon], {
        radius: 12,
        weight: 2,
        color: "#FF0000",
        fillColor: "#FF0000",
      }).addTo(map);
    }
  },
);
/**
 * @type {HTMLSelectElement}
 */
const lineSelect = document.getElementById("line-select");
const recenterViewBtn = document.getElementById("recenter-view");
const terminiByTripId = new Map();
const stopsInfo = new Map();
let gtfsCache;
const busPostionAPIURL =
  "https://proxy.transport.data.gouv.fr/resource/ametis-amiens-gtfs-rt-vehicle-position";
const PROTO_URL =
  "https://raw.githubusercontent.com/MobilityData/transit-translations/master/gtfs-realtime/proto/gtfs-realtime.proto";
let choicedLine = "N1";
const busMarkers = new Map();
const stopsMarkers = new Map();
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

recenterViewBtn.addEventListener("click", () =>
  map.setView([userLat, userLon], 15),
);

lineSelect.addEventListener("change", async (event) => {
  choicedLine = event.target.value;
  await displayBusPositions();
  displayStops();
});

async function init() {
  await loadTermini();
  await displayBusPositions();
  await loadStops();
  displayStops();
  setInterval(displayBusPositions, 5000);
}

init().catch(console.error);

async function displayBusPositions() {
  const allBus = await reedBusPositions();
  const lineBus = allBus.filter((bus) => bus.line === choicedLine);
  const activeIds = new Set(lineBus.map((bus) => bus.id));
  busMarkers.forEach((marker, id) => {
    if (!activeIds.has(id)) {
      marker.remove();
      busMarkers.delete(id);
    }
  });
  lineBus.forEach((bus) => {
    const terminus = terminiByTripId.get(bus.tripId) ?? "Inconnu";
    const busPosition = [bus.latitude, bus.longitude];
    if (busMarkers.has(bus.id)) {
      const marker = busMarkers.get(bus.id);
      marker.setLatLng(busPosition);
      marker.setPopupContent(
        `<strong>Bus ${bus.line}</strong><br>Terminus : ${terminus}`,
      );
    } else {
      const marker = L.circleMarker(busPosition, {
        color: "#0088ff",
        fillColor: "##0088ff",
        weight: 2,
        radius: 8,
      })
        .addTo(map)
        .bindPopup(
          `<strong>Bus ${bus.line}</strong><br>Terminus : ${terminus}`,
        );
      busMarkers.set(bus.id, marker);
    }
  });
}

async function loadGTFSSchema() {
  const response = await fetch(PROTO_URL);
  if (!response.ok) {
    throw new Error(`Erreur du schéma, HTTP: ${response.status}`);
  }
  const protoText = await response.text();
  const root = protobuf.parse(protoText).root;
  return root.lookupType("transit_realtime.FeedMessage");
}

async function reedBusPositions() {
  const FeedMessage = await loadGTFSSchema();
  const response = await fetch(busPostionAPIURL);
  if (!response.ok) {
    throw new Error(`Erreur du flux, HTTP: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const data = FeedMessage.decode(new Uint8Array(buffer));
  const bus = data.entity.map((entity) => {
    const vehicle = entity.vehicle;
    const position = vehicle.position;
    return {
      id: vehicle.vehicle?.id,
      line: vehicle.trip?.routeId ?? "Inconnue",
      latitude: position.latitude,
      longitude: position.longitude,
      direction: position.bearing ?? null,
      timestamp: vehicle.timestamp?.toString() ?? null,
      tripId: vehicle.trip?.tripId ?? null,
    };
  });
  return bus;
}

async function loadTermini() {
  const response = await fetch("./data/ametis-gtfs.zip");
  if (!response.ok) {
    throw new Error(`Erreur GTFS : HTTP ${response.status}`);
  }
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const tripsFile = Object.values(zip.files).find(
    (file) => !file.dir && file.name.endsWith("trips.txt"),
  );
  if (!tripsFile) {
    throw new Error("Fichier trips.txt introuvable");
  }
  const csv = await tripsFile.async("text");
  const result = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true,
  });
  for (const trip of result.data) {
    if (trip.trip_id && trip.trip_headsign) {
      terminiByTripId.set(trip.trip_id, trip.trip_headsign);
    }
  }
}

async function loadGTFS() {
  if (!gtfsCache) {
    gtfsCache = (async () => {
      const response = await fetch("./data/ametis-gtfs.zip");
      if (!response.ok) {
        throw new Error(`Erreur GTFS : HTTP ${response.status}`);
      }
      const zip = await JSZip.loadAsync(await response.arrayBuffer());
      async function parseFile(filename) {
        const file = zip.file(filename);
        if (!file) {
          throw new Error(`Fichier absent du zip: ${filename}`);
        }
        const csv = await file.async("text");
        return Papa.parse(csv, {
          header: true,
          skipEmptyLines: true,
        }).data;
      }
      const [stops, stopTimes, trips, routes] = await Promise.all([
        parseFile("stops.txt"),
        parseFile("stop_times.txt"),
        parseFile("trips.txt"),
        parseFile("routes.txt"),
      ]);
      return { stops, stopTimes, trips, routes };
    })().catch((error) => {
      gtfsCache = null;
      throw error;
    });
  }
  return gtfsCache;
}

async function loadStops() {
  const { stops, stopTimes, trips, routes } = await loadGTFS();
  const tripToRoute = new Map(trips.map((t) => [t.trip_id, t.route_id]));
  const routeById = new Map(routes.map((r) => [r.route_id, r]));
  const stopToRoutes = new Map();
  for (const time of stopTimes) {
    const routeId = tripToRoute.get(time.trip_id);
    if (routeId === undefined) continue;
    if (!stopToRoutes.has(time.stop_id)) {
      stopToRoutes.set(time.stop_id, new Set());
    }
    stopToRoutes.get(time.stop_id).add(routeId);
  }
  stops.forEach((stop) => {
    const id = stop.stop_id;
    const name = stop.stop_name;
    const latitude = Number(stop.stop_lat);
    const longitude = Number(stop.stop_lon);
    const lines = [...(stopToRoutes.get(id) ?? [])]
      .map((id) => routeById.get(id))
      .filter(Boolean)
      .map((route) => ({
        id: route.route_id,
        number: route.route_short_name,
        name: route.route_long_name,
      }));
    stopsInfo.set(
      lines.map((line) => line.number),
      { id, name, latitude, longitude, lines },
    );
  });
}

function deleteStopMarker(key) {
    if (stopsMarkers.has(key)) {
        stopsMarkers.get(key).remove();
        stopsMarkers.delete(key);
    }
}

function displayStops() {
  const validStops = [];
  stopsInfo.forEach((info) =>
    info.lines.filter((line) =>
      line.number == choicedLine ? validStops.push(info) : stopsMarkers.has(`${info.id}.${line.number}`) ? deleteStopMarker(`${info.id}.${line.number}`) : null,
    ),
  );
  validStops.forEach((stop) => {
    const marker = L.circleMarker([stop.latitude, stop.longitude], {
      radius: 10,
      color: "#00BB00",
      fillColor: "#00BB00",
      weight: 2,
    })
      .addTo(map)
      .bindPopup(`Arrêt ${stop.name}`);
    stopsMarkers.set(`${stop.id}.${choicedLine}`, marker);
  });
}
