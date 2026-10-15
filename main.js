/**
 * @type {HTMLSelectElement}
 */
const lineSelect = document.getElementById("line-select");
const terminiByTripId = new Map();
const busPostionAPIURL =
  "https://proxy.transport.data.gouv.fr/resource/ametis-amiens-gtfs-rt-vehicle-position";
const PROTO_URL =
  "https://raw.githubusercontent.com/MobilityData/transit-translations/master/gtfs-realtime/proto/gtfs-realtime.proto";
let choicedLine = "N1";
const markers = new Map();
const map = L.map("map").setView([49.891102, 2.30839], 15);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

lineSelect.addEventListener("change", async (event) => {
  choicedLine = event.target.value;
  displayBusPositions();
});

async function init() {
  await loadTermini();
  await displayBusPositions();
  setInterval(displayBusPositions, 5000);
}

init().catch(console.error);

(async () => displayBusPositions())();

async function displayBusPositions() {
  const allBus = await reedBusPositions();
  const lineBus = allBus.filter((bus) => bus.line === choicedLine);
  const activeIds = new Set(lineBus.map((bus) => bus.id));
  markers.forEach((marker, id) => {
    if (!activeIds.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  });
  lineBus.forEach((bus) => {
    const terminus = terminiByTripId.get(bus.tripId) ?? "Inconnu";
    const busPosition = [bus.latitude, bus.longitude];
    if (markers.has(bus.id)) {
      const marker = markers.get(bus.id);
      marker.setLatLng(busPosition);
      marker.setPopupContent(
        `<strong>Bus ${bus.line}</strong><br>Terminus : ${terminus}`,
      );
    } else {
      const marker = L.marker(busPosition)
        .addTo(map)
        .bindPopup(
          `<strong>Bus ${bus.line}</strong><br>Terminus : ${terminus}`,
        );
      markers.set(bus.id, marker);
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
  console.log("Taille reçue, ", buffer.byteLength, "octets");
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
  console.log("Destinations chargées :", terminiByTripId.size);
}
