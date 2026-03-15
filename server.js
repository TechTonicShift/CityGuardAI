const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const {
  buildDistrictLayout,
  circlePolygon,
  createDroneRoute,
  createGroundRoute,
  featureCollection,
  lineFeature,
  pointFeature,
  positionAlongRoute
} = require("./city-layout");

const root = __dirname;
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "store.json");
const seedFile = path.join(dataDir, "seed.json");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const districtLayout = buildDistrictLayout();
const streamClients = new Set();
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/api").replace(/\/$/, "");
const OLLAMA_MODEL = "qwen3-coder:480b-cloud";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const aiCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const SCENARIO_PRESETS = {
  "burst-main-school": {
    key: "burst-main-school",
    label: "Burst Main",
    category: "water",
    severity: "critical",
    description: "An underground water main ruptures beneath the school frontage and threatens nearby blocks.",
    hint: "Shows a pressurized water bloom, pipe stress, and the school safety buffer.",
    title: "Burst main under Peninsula Public School",
    summary: "Pressure mesh and subsurface acoustic sensors indicate a fast-rising rupture directly below the school approach.",
    confidence: 0.93,
    impact: "Water loss and lane washout risk could disrupt the school frontage within 12 minutes.",
    recommendation: "Dispatch PipeBot, isolate the branch valve, and hold a school perimeter until pressure stabilizes.",
    sensorId: "W-204",
    targetType: "pipe",
    targetId: "pipe-sector-12",
    location: "Peninsula Public School / Sector 12 Main",
    coordinate: districtLayout.anchors.scenarios["burst-main-school"],
    landmarkId: "b-public-school",
    landmarkLabel: "Peninsula Public School",
    visualType: "water_burst",
    visualLabel: "Pressure bloom",
    visualSummary: "A blue pressure bloom and spray spokes show where the underground main is breaking beneath the school frontage.",
    publicNote: "The city has placed the school frontage into protective response mode while the main is isolated."
  },
  "pollution-spike-factory": {
    key: "pollution-spike-factory",
    label: "Pollution Spike",
    category: "air",
    severity: "high",
    description: "A fast-moving emissions spike forms near the factory stack and drifts across the industrial belt.",
    hint: "Shows a directional plume, particulate sampling points, and the likely downwind impact area.",
    title: "Pollution spike near East Stack Factory",
    summary: "Air quality towers and stack telemetry caught a sudden particulate jump near the primary factory exhaust path.",
    confidence: 0.88,
    impact: "AQI could exceed 145 in nearby blocks within 15 minutes if the source is not neutralized.",
    recommendation: "Launch the mapping drone, verify the source, and position AirSweep downwind for neutralization.",
    sensorId: "A-076",
    targetType: "zone",
    targetId: "zone-east",
    location: "East Stack Factory / Industrial Belt",
    coordinate: districtLayout.anchors.scenarios["pollution-spike-factory"],
    landmarkId: "b-east-factory",
    landmarkLabel: "East Stack Factory",
    visualType: "pollution_plume",
    visualLabel: "Drift plume",
    visualSummary: "A translucent plume shows where particulates are drifting, while floating sample points show where the drone is validating air quality.",
    publicNote: "The system is containing the emissions spike and tracking downwind spread in real time."
  },
  "transit-corridor-fracture": {
    key: "transit-corridor-fracture",
    label: "Transit Fracture",
    category: "roads",
    severity: "high",
    description: "Road vision units detect a widening fracture across the transit corridor surface.",
    hint: "Shows fracture seams, the affected lane envelope, and the rover repair path.",
    title: "Transit corridor fracture detected",
    summary: "Surface vision and axle-vibration nodes found a crack line spreading across the main transit lane.",
    confidence: 0.86,
    impact: "Pothole formation and lane slowdown are likely during the next heavy load cycle.",
    recommendation: "Send Road Rover to print a temporary composite patch and stabilize the lane edge.",
    sensorId: "R-118",
    targetType: "road",
    targetId: "road-transit-corridor",
    location: "Transit Corridor",
    coordinate: districtLayout.anchors.scenarios["transit-corridor-fracture"],
    landmarkId: null,
    landmarkLabel: "Transit Corridor",
    visualType: "road_fracture",
    visualLabel: "Surface fracture",
    visualSummary: "Dark seam lines mark the spreading crack while the highlighted lane shows the repair envelope.",
    publicNote: "Autonomous lane repair is underway and transit impact is being kept local."
  },
  "flash-flood-river-edge": {
    key: "flash-flood-river-edge",
    label: "Flash Flood",
    category: "flood",
    severity: "high",
    description: "Drain sonar catches a sudden surge near the river edge before curb flooding spreads inland.",
    hint: "Shows the inundation pocket, flood front, and the storm-drain spine under pressure.",
    title: "Flash flood near River Edge",
    summary: "Storm-drain sonar reports a rapid inflow surge near the retention basin and river-adjacent drain spine.",
    confidence: 0.84,
    impact: "Localized curb flooding could affect river-edge access roads within 10 minutes.",
    recommendation: "Dispatch AirSweep for pressure diversion, inspect the drain spine, and route runoff away from housing.",
    sensorId: "P-330",
    targetType: "pipe",
    targetId: "pipe-river-drain",
    location: "River Edge retention basin",
    coordinate: districtLayout.anchors.scenarios["flash-flood-river-edge"],
    landmarkId: "b-river-housing",
    landmarkLabel: "River Edge",
    visualType: "flood_surge",
    visualLabel: "Flood spread",
    visualSummary: "A blue flood pocket shows where water is pooling, and the wave front traces where runoff is pushing next.",
    publicNote: "The city is diverting flow and protecting the river-edge block while drain pressure is reduced."
  }
};

function nextCounter(items, prefix, fallback) {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const max = (items || []).reduce((highest, item) => {
    if (!item || typeof item.id !== "string") {
      return highest;
    }
    const match = item.id.match(pattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, fallback - 1);
  return Math.max(fallback, max + 1);
}

function offsetCoordinate(coordinate, lngOffset, latOffset) {
  return [
    Number((coordinate[0] + lngOffset).toFixed(6)),
    Number((coordinate[1] + latOffset).toFixed(6))
  ];
}

function polygonOverlay(id, coordinates, properties) {
  return {
    type: "Feature",
    id,
    properties: { id, ...properties },
    geometry: {
      type: "Polygon",
      coordinates
    }
  };
}

function defaultVisualType(category) {
  if (category === "water") {
    return "water_burst";
  }
  if (category === "air") {
    return "pollution_plume";
  }
  if (category === "flood") {
    return "flood_surge";
  }
  return "road_fracture";
}

function defaultVisualLabel(category) {
  if (category === "water") {
    return "Pressure bloom";
  }
  if (category === "air") {
    return "Drift plume";
  }
  if (category === "flood") {
    return "Flood spread";
  }
  return "Surface fracture";
}

function defaultVisualSummary(category, location) {
  if (category === "water") {
    return `A burst footprint is rendered directly above the damaged main near ${location}.`;
  }
  if (category === "air") {
    return `A moving plume shows how air quality degradation is spreading near ${location}.`;
  }
  if (category === "flood") {
    return `A flood pocket shows where water is gathering and where runoff is pushing next near ${location}.`;
  }
  return `Fracture seams mark the road section under repair near ${location}.`;
}

function scenarioPresetList() {
  return Object.values(SCENARIO_PRESETS).map((preset) => ({
    key: preset.key,
    label: preset.label,
    category: preset.category,
    severity: preset.severity,
    description: preset.description,
    hint: preset.hint,
    visualLabel: preset.visualLabel,
    landmarkLabel: preset.landmarkLabel
  }));
}

function normalizeIncident(incident) {
  if (!incident) {
    return;
  }

  incident.scenarioKey = incident.scenarioKey || `custom-${incident.category}`;
  incident.visualType = incident.visualType || defaultVisualType(incident.category);
  incident.visualLabel = incident.visualLabel || defaultVisualLabel(incident.category);
  incident.visualSummary = incident.visualSummary || defaultVisualSummary(incident.category, incident.location);
  incident.publicNote = incident.publicNote || incident.aiAssessment.predictedImpact;
  incident.landmarkId = incident.landmarkId || null;
  incident.landmarkLabel = incident.landmarkLabel || incident.location;
}

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(dataFile)) {
    fs.copyFileSync(seedFile, dataFile);
  }
}

ensureDataFile();

let state = readState();
let eventCounter = nextCounter(state.timeline, "EVT", (state.timeline || []).length + 1);
let incidentCounter = nextCounter(state.incidents, "INC", 4001);
let missionCounter = nextCounter(state.missions, "MIS", 9101);
let simulationHoldUntil = 0;

function readState() {
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function writeState() {
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function ollamaHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY && OLLAMA_BASE_URL.startsWith("https://")) {
    headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;
  }
  return headers;
}

async function ollamaJson(pathname, options = {}) {
  const response = await fetch(`${OLLAMA_BASE_URL}${pathname}`, {
    headers: ollamaHeaders(),
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Ollama request failed with ${response.status}`);
  }

  return response.json();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function addTimeline(kind, message, incidentId = null) {
  state.timeline.unshift({
    id: `EVT-${eventCounter++}`,
    time: new Date().toISOString(),
    kind,
    message,
    incidentId
  });
  state.timeline = state.timeline.slice(0, 40);
}

function sensorReadingFor(category) {
  if (category === "water") {
    return `Pressure delta ${Math.floor(Math.random() * 16) + 9}%`;
  }
  if (category === "roads") {
    return `Fracture spread ${Math.floor(Math.random() * 14) + 6}%`;
  }
  if (category === "air") {
    return `AQI ${Math.floor(Math.random() * 42) + 118}`;
  }
  return `Flow surge ${Math.floor(Math.random() * 18) + 7}%`;
}

function severityRadius(category) {
  if (category === "water") {
    return { lng: 0.00028, lat: 0.00022 };
  }
  if (category === "roads") {
    return { lng: 0.00024, lat: 0.00018 };
  }
  if (category === "air") {
    return { lng: 0.00042, lat: 0.00032 };
  }
  return { lng: 0.00036, lat: 0.00028 };
}

function capabilityMatch(category, asset) {
  if (category === "water") {
    return asset.capabilities.includes("sealant clamp");
  }
  if (category === "roads") {
    return asset.capabilities.includes("asphalt print repair");
  }
  if (category === "air") {
    return asset.capabilities.includes("air sampling") || asset.capabilities.includes("mapping");
  }
  return asset.capabilities.includes("pressure diversion") || asset.capabilities.includes("inspection");
}

function routeForAsset(asset, incident) {
  return asset.type === "drone"
    ? createDroneRoute(asset.position, incident.coordinate)
    : createGroundRoute(asset.position, incident.coordinate);
}

function resolveSensorForCategory(category) {
  const preferred = state.sensors.find((sensor) => sensor.category === category && sensor.status === "nominal");
  if (preferred) {
    return preferred;
  }
  return state.sensors.find((sensor) => sensor.category === category);
}

function reconcileState() {
  for (const incident of state.incidents) {
    normalizeIncident(incident);
  }

  for (const sensor of state.sensors) {
    if (!sensor.position) {
      sensor.position = districtLayout.anchors.sensors[sensor.id];
    }
    const activeIncident = state.incidents.find((incident) => incident.sensorId === sensor.id && incident.status !== "resolved");
    sensor.status = activeIncident ? "alert" : "nominal";
    if (!activeIncident && sensor.reading === "Recovered") {
      sensor.health = Math.min(98, sensor.health + 1);
    }
  }

  for (const asset of state.assets) {
    if (!asset.homePosition) {
      asset.homePosition = districtLayout.anchors.assets[asset.id];
    }
    if (!asset.position) {
      asset.position = asset.homePosition;
    }

    const mission = state.missions.find((item) => item.assetId === asset.id && item.status === "active");
    if (mission) {
      if (!mission.route) {
        const incident = state.incidents.find((item) => item.id === mission.incidentId);
        if (incident) {
          mission.route = routeForAsset(asset, incident);
        }
      }
      asset.status = "busy";
      asset.currentMission = mission.incidentId;
      asset.position = positionAlongRoute(mission.route, Math.min(mission.progress / 70, 1)) || asset.position;
    } else if (asset.status === "busy") {
      asset.status = asset.battery < 45 ? "charging" : "ready";
      asset.currentMission = null;
      asset.position = asset.homePosition;
    }
  }
}

function cloneFeatureCollection(features) {
  return featureCollection(JSON.parse(JSON.stringify(features)));
}

function colorForSeverity(severity) {
  if (severity === "critical") {
    return "#ff6262";
  }
  if (severity === "high") {
    return "#ff8b4a";
  }
  return "#ffd65e";
}

function buildingColorForGroup(group) {
  const palette = {
    civic: "#8fa3b6",
    health: "#9cb08a",
    commercial: "#c69c77",
    infrastructure: "#7fa1a0",
    education: "#d2af66",
    utility: "#7d97b1",
    mobility: "#9b8bb8",
    data: "#8a9ccc",
    residential: "#b7c2a2",
    industrial: "#8f867c"
  };
  return palette[group] || "#8ea2b5";
}

function zoneColorForType(zoneType) {
  const palette = {
    residential: "#d6e5df",
    civic: "#ece1d1",
    utility: "#dce7ed",
    industrial: "#e7ddd6"
  };
  return palette[zoneType] || "#dde5ea";
}

function scenarioWaterFeatures(incident) {
  const center = incident.coordinate;
  const burstCenter = offsetCoordinate(center, 0, -0.00002);
  const burst = polygonOverlay(`${incident.id}-water-burst`, circlePolygon(burstCenter, 0.00018, 0.00012), {
    incidentId: incident.id,
    color: "#35a6ff",
    title: incident.title
  });
  const sprayOffsets = [
    [0.00016, 0],
    [0.00010, 0.00010],
    [-0.00012, 0.00008],
    [-0.00016, -0.00001],
    [0.00008, -0.00010],
    [-0.00004, -0.00011]
  ];
  const sprays = sprayOffsets.map((offset, index) => lineFeature(`${incident.id}-spray-${index}`, [
    center,
    offsetCoordinate(center, offset[0], offset[1])
  ], {
    incidentId: incident.id,
    color: "#35a6ff",
    title: `${incident.title} spray`
  }));

  return { burst, sprays };
}

function scenarioPollutionFeatures(incident) {
  const center = incident.coordinate;
  const plume = polygonOverlay(`${incident.id}-plume`, [[
    offsetCoordinate(center, -0.00007, -0.00004),
    offsetCoordinate(center, 0.00008, -0.00009),
    offsetCoordinate(center, 0.00028, -0.00005),
    offsetCoordinate(center, 0.00048, 0.00002),
    offsetCoordinate(center, 0.00044, 0.00014),
    offsetCoordinate(center, 0.00024, 0.00016),
    offsetCoordinate(center, 0.00002, 0.00009),
    offsetCoordinate(center, -0.00008, 0.00003),
    offsetCoordinate(center, -0.00007, -0.00004)
  ]], {
    incidentId: incident.id,
    color: "#6fa85f",
    title: incident.title
  });
  const particles = [
    [0.00006, 0.00002],
    [0.00016, -0.00001],
    [0.00024, 0.00005],
    [0.00034, 0.00001],
    [0.00042, 0.00008]
  ].map((offset, index) => pointFeature(`${incident.id}-particle-${index}`, offsetCoordinate(center, offset[0], offset[1]), {
    incidentId: incident.id,
    color: "#5f8f44",
    title: incident.title
  }));

  return { plume, particles };
}

function scenarioFloodFeatures(incident) {
  const center = incident.coordinate;
  const extent = polygonOverlay(`${incident.id}-flood`, [[
    offsetCoordinate(center, -0.00042, -0.00003),
    offsetCoordinate(center, 0.00028, -0.00006),
    offsetCoordinate(center, 0.00036, 0.00009),
    offsetCoordinate(center, 0.00010, 0.00022),
    offsetCoordinate(center, -0.00028, 0.00018),
    offsetCoordinate(center, -0.00046, 0.00008),
    offsetCoordinate(center, -0.00042, -0.00003)
  ]], {
    incidentId: incident.id,
    color: "#4b9dff",
    title: incident.title
  });
  const front = lineFeature(`${incident.id}-flood-front`, [
    offsetCoordinate(center, -0.00024, 0.00016),
    offsetCoordinate(center, -0.00006, 0.00019),
    offsetCoordinate(center, 0.00010, 0.00020),
    offsetCoordinate(center, 0.00028, 0.00017)
  ], {
    incidentId: incident.id,
    color: "#4b9dff",
    title: `${incident.title} flood front`
  });

  return { extent, front };
}

function scenarioRoadFeatures(incident) {
  const center = incident.coordinate;
  const fractures = [
    [[-0.00016, -0.00003], [-0.00004, 0.00002]],
    [[-0.00001, -0.00004], [0.00012, 0.00003]],
    [[0.00004, -0.00001], [0.00019, 0.00004]]
  ].map((segment, index) => lineFeature(`${incident.id}-fracture-${index}`, [
    offsetCoordinate(center, segment[0][0], segment[0][1]),
    offsetCoordinate(center, segment[1][0], segment[1][1])
  ], {
    incidentId: incident.id,
    color: "#3d342b",
    title: incident.title
  }));
  const envelope = polygonOverlay(`${incident.id}-road-envelope`, [[
    offsetCoordinate(center, -0.00028, -0.00005),
    offsetCoordinate(center, 0.00028, -0.00005),
    offsetCoordinate(center, 0.00028, 0.00005),
    offsetCoordinate(center, -0.00028, 0.00005),
    offsetCoordinate(center, -0.00028, -0.00005)
  ]], {
    incidentId: incident.id,
    color: "#ffb663",
    title: incident.title
  });

  return { fractures, envelope };
}

async function getAiStatus() {
  try {
    await ollamaJson("/tags");
    return {
      configured: true,
      available: true,
      provider: "ollama",
      baseUrl: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
      hint: "Ollama runtime reachable."
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      provider: "ollama",
      baseUrl: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
      hint: "Start Ollama locally and sign in if you want to use cloud models through the local endpoint.",
      error: error.message
    };
  }
}

function aiContextForIncident(incident) {
  const assets = state.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    status: asset.status,
    battery: asset.battery,
    currentMission: asset.currentMission,
    capabilities: asset.capabilities
  }));

  return {
    city: {
      name: state.city.name,
      districtName: state.city.districtName,
      mode: state.city.mode,
      health: state.city.health,
      resolvedToday: state.city.resolvedToday
    },
    incident,
    assets,
    activeIncidents: state.incidents.filter((item) => item.status !== "resolved").map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      severity: item.severity,
      status: item.status,
      assignedAssetId: item.assignedAssetId
    }))
  };
}

async function generateAiIncidentAnalysis(incidentId) {
  const cacheKey = `incident:${incidentId}`;
  if (aiCache.has(cacheKey)) {
    return aiCache.get(cacheKey);
  }

  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) {
    throw new Error("Incident not found");
  }

  const schema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      dispatch_recommendation: { type: "string" },
      why_this_matters: { type: "string" },
      why_this_asset: { type: "string" },
      repair_steps: {
        type: "array",
        items: { type: "string" }
      },
      stakeholder_update: { type: "string" },
      next_10_minutes: { type: "string" },
      confidence: { type: "number" }
    },
    required: [
      "summary",
      "dispatch_recommendation",
      "why_this_matters",
      "why_this_asset",
      "repair_steps",
      "stakeholder_update",
      "next_10_minutes",
      "confidence"
    ]
  };

  const context = aiContextForIncident(incident);
  const response = await ollamaJson("/chat", {
    method: "POST",
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: schema,
      options: { temperature: 0.1 },
      messages: [
        {
          role: "system",
          content: "You are NeoGrid AI Ops Copilot. Use only the supplied city and incident data. Respond with concise operational JSON."
        },
        {
          role: "user",
          content: `Analyze this self-healing city incident and produce an operational briefing.\nSchema: ${JSON.stringify(schema)}\nContext: ${JSON.stringify(context)}`
        }
      ]
    })
  });

  const parsed = JSON.parse(response.message.content);
  const payload = {
    scope: "incident",
    incidentId,
    model: OLLAMA_MODEL,
    generatedAt: new Date().toISOString(),
    content: parsed
  };
  aiCache.set(cacheKey, payload);
  return payload;
}

async function generateAiCityBriefing() {
  const cacheKey = `city:${state.timeline[0] ? state.timeline[0].id : "none"}`;
  if (aiCache.has(cacheKey)) {
    return aiCache.get(cacheKey);
  }

  const schema = {
    type: "object",
    properties: {
      executive_summary: { type: "string" },
      city_posture: { type: "string" },
      top_risks: {
        type: "array",
        items: { type: "string" }
      },
      asset_readiness: { type: "string" },
      next_actions: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: [
      "executive_summary",
      "city_posture",
      "top_risks",
      "asset_readiness",
      "next_actions"
    ]
  };

  const context = {
    city: state.city,
    metrics: deriveOverview().metrics,
    incidents: state.incidents.slice(0, 6).map((incident) => ({
      id: incident.id,
      title: incident.title,
      category: incident.category,
      severity: incident.severity,
      status: incident.status,
      location: incident.location
    })),
    assets: state.assets.map((asset) => ({
      name: asset.name,
      status: asset.status,
      battery: asset.battery,
      currentMission: asset.currentMission
    })),
    latestTimeline: state.timeline.slice(0, 8)
  };

  const response = await ollamaJson("/chat", {
    method: "POST",
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: schema,
      options: { temperature: 0.1 },
      messages: [
        {
          role: "system",
          content: "You are NeoGrid AI Ops Copilot. Produce a short executive city briefing grounded only in the supplied operational state."
        },
        {
          role: "user",
          content: `Create an executive briefing for stakeholders.\nSchema: ${JSON.stringify(schema)}\nContext: ${JSON.stringify(context)}`
        }
      ]
    })
  });

  const parsed = JSON.parse(response.message.content);
  const payload = {
    scope: "city",
    model: OLLAMA_MODEL,
    generatedAt: new Date().toISOString(),
    content: parsed
  };
  aiCache.set(cacheKey, payload);
  return payload;
}

function buildMapPayload() {
  const buildings = cloneFeatureCollection(districtLayout.buildings);
  const roads = cloneFeatureCollection(districtLayout.roads);
  const pipes = cloneFeatureCollection(districtLayout.pipes);
  const zones = cloneFeatureCollection(districtLayout.zones);
  const waterBodies = cloneFeatureCollection(districtLayout.waterBodies);
  const depots = cloneFeatureCollection(districtLayout.depots);
  const landmarks = cloneFeatureCollection(districtLayout.landmarks);
  const waterBursts = [];
  const waterSprays = [];
  const pollutionPlumes = [];
  const pollutionParticles = [];
  const floodExtents = [];
  const floodFronts = [];
  const roadEnvelopes = [];
  const roadFractures = [];

  for (const feature of buildings.features) {
    feature.properties.status = "nominal";
    feature.properties.color = buildingColorForGroup(feature.properties.group);
  }
  for (const feature of roads.features) {
    feature.properties.status = "nominal";
    feature.properties.color = feature.properties.roadType === "transit" ? "#7cf2ff" : "#8ca4bf";
    feature.properties.width = feature.properties.roadType === "arterial" ? 4.5 : 3.5;
  }
  for (const feature of pipes.features) {
    feature.properties.status = "nominal";
    feature.properties.color = feature.properties.networkType === "storm" ? "#3cb1ff" : "#5affcd";
    feature.properties.width = feature.properties.networkType === "storm" ? 2.8 : 2.2;
  }
  for (const feature of zones.features) {
    feature.properties.color = zoneColorForType(feature.properties.zoneType);
  }
  for (const feature of waterBodies.features) {
    feature.properties.color = "#9fd2ef";
  }
  for (const feature of landmarks.features) {
    feature.properties.textColor = "#1e1d1a";
  }

  for (const incident of state.incidents.filter((item) => item.status !== "resolved")) {
    normalizeIncident(incident);

    if (incident.targetType === "building") {
      const building = buildings.features.find((feature) => feature.properties.id === incident.targetId);
      if (building) {
        building.properties.status = "alert";
        building.properties.color = colorForSeverity(incident.severity);
      }
    }
    if (incident.targetType === "road") {
      const road = roads.features.find((feature) => feature.properties.id === incident.targetId);
      if (road) {
        road.properties.status = "alert";
        road.properties.color = colorForSeverity(incident.severity);
      }
    }
    if (incident.targetType === "pipe") {
      const pipe = pipes.features.find((feature) => feature.properties.id === incident.targetId);
      if (pipe) {
        pipe.properties.status = "alert";
        pipe.properties.color = colorForSeverity(incident.severity);
      }
    }
    if (incident.targetType === "zone") {
      const zone = zones.features.find((feature) => feature.properties.id === incident.targetId);
      if (zone) {
        zone.properties.color = "#b65e00";
      }
    }

    if (incident.landmarkId) {
      const building = buildings.features.find((feature) => feature.properties.id === incident.landmarkId);
      if (building) {
        building.properties.status = "alert";
        building.properties.color = colorForSeverity(incident.severity);
      }
    }

    if (incident.visualType === "water_burst") {
      const { burst, sprays } = scenarioWaterFeatures(incident);
      waterBursts.push(burst);
      waterSprays.push(...sprays);
    } else if (incident.visualType === "pollution_plume") {
      const { plume, particles } = scenarioPollutionFeatures(incident);
      pollutionPlumes.push(plume);
      pollutionParticles.push(...particles);
    } else if (incident.visualType === "flood_surge") {
      const { extent, front } = scenarioFloodFeatures(incident);
      floodExtents.push(extent);
      floodFronts.push(front);
    } else if (incident.visualType === "road_fracture") {
      const { envelope, fractures } = scenarioRoadFeatures(incident);
      roadEnvelopes.push(envelope);
      roadFractures.push(...fractures);
    }
  }

  return {
    view: districtLayout.meta,
    waterBodies,
    buildings,
    roads,
    pipes,
    zones,
    depots,
    landmarks,
    sensors: featureCollection(state.sensors.map((sensor) => pointFeature(sensor.id, sensor.position, {
      category: sensor.category,
      name: sensor.name,
      status: sensor.status,
      health: sensor.health
    }))),
    assets: featureCollection(state.assets.map((asset) => pointFeature(asset.id, asset.position, {
      name: asset.name,
      shortLabel: asset.shortLabel,
      status: asset.status,
      battery: asset.battery,
      type: asset.type,
      color: asset.type === "drone" ? "#8bf7ff" : "#ffe76a"
    }))),
    incidents: featureCollection(state.incidents
      .filter((incident) => incident.status !== "resolved")
      .map((incident) => pointFeature(incident.id, incident.coordinate, {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      severity: incident.severity,
      category: incident.category,
      color: colorForSeverity(incident.severity)
    }))),
    incidentAreas: featureCollection(state.incidents
      .filter((incident) => incident.status !== "resolved")
      .map((incident) => {
        const radius = severityRadius(incident.category);
        return {
          type: "Feature",
          id: `${incident.id}-area`,
          properties: {
            id: `${incident.id}-area`,
            incidentId: incident.id,
            category: incident.category,
            severity: incident.severity,
            color: colorForSeverity(incident.severity)
          },
          geometry: {
            type: "Polygon",
            coordinates: circlePolygon(incident.coordinate, radius.lng, radius.lat)
          }
        };
      })),
    waterBursts: featureCollection(waterBursts),
    waterSprays: featureCollection(waterSprays),
    pollutionPlumes: featureCollection(pollutionPlumes),
    pollutionParticles: featureCollection(pollutionParticles),
    floodExtents: featureCollection(floodExtents),
    floodFronts: featureCollection(floodFronts),
    roadEnvelopes: featureCollection(roadEnvelopes),
    roadFractures: featureCollection(roadFractures),
    routes: featureCollection(state.missions.map((mission) => lineFeature(mission.id, mission.route, {
      incidentId: mission.incidentId,
      assetId: mission.assetId,
      color: mission.assetType === "drone" ? "#7cf2ff" : "#ffd75a",
      progress: mission.progress
    })))
  };
}

function deriveOverview() {
  const openIncidents = state.incidents.filter((incident) => incident.status !== "resolved").length;
  const activeMissions = state.missions.filter((mission) => mission.status === "active").length;
  const readyAssets = state.assets.filter((asset) => asset.status === "ready").length;
  const averageSensorHealth = Math.round(
    state.sensors.reduce((sum, sensor) => sum + sensor.health, 0) / state.sensors.length
  );

  state.city.activeIncidents = openIncidents;
  state.city.health = Math.max(74, Math.min(99, Math.round((averageSensorHealth + readyAssets * 3) / 1.15)));

  return {
    city: state.city,
    ai: {
      provider: "ollama",
      model: OLLAMA_MODEL,
      baseUrl: OLLAMA_BASE_URL
    },
    scenarios: {
      presets: scenarioPresetList()
    },
    metrics: {
      openIncidents,
      activeMissions,
      readyAssets,
      averageSensorHealth,
      automatedResolutionRate: state.city.mode === "auto-heal" ? 92 : 38
    },
    map: buildMapPayload(),
    sensors: state.sensors,
    incidents: state.incidents.slice(0, 10),
    missions: state.missions,
    assets: state.assets,
    timeline: state.timeline
  };
}

function broadcastOverview() {
  const payload = JSON.stringify(deriveOverview());
  for (const client of streamClients) {
    client.write(`event: overview\n`);
    client.write(`data: ${payload}\n\n`);
  }
}

function commitAndBroadcast() {
  reconcileState();
  aiCache.clear();
  writeState();
  broadcastOverview();
}

function refreshAssetStatus() {
  for (const asset of state.assets) {
    if (asset.status === "charging") {
      asset.battery = Math.min(100, asset.battery + 5);
      if (asset.battery >= 70) {
        asset.status = "ready";
      }
    } else if (asset.status === "ready") {
      asset.battery = Math.max(36, asset.battery - 1);
    } else if (asset.status === "busy") {
      asset.battery = Math.max(24, asset.battery - 3);
    }
  }
}

function closeMission(mission, incident, asset, reason) {
  mission.status = "completed";
  asset.status = asset.battery < 45 ? "charging" : "ready";
  asset.currentMission = null;
  asset.position = asset.homePosition;
  incident.status = "resolved";
  incident.worklog.unshift(reason);
  incident.worklog.unshift("Verification mesh confirms the affected system returned to safe baseline.");
  state.city.resolvedToday += 1;
  const sensor = state.sensors.find((item) => item.id === incident.sensorId);
  if (sensor) {
    sensor.status = "nominal";
    sensor.reading = "Recovered";
    sensor.health = Math.min(99, sensor.health + 6);
    sensor.lastUpdatedAt = new Date().toISOString();
  }
  addTimeline("repair", `${incident.id} resolved by ${asset.name}.`, incident.id);
}

function stepMissions() {
  for (const mission of state.missions) {
    if (mission.status !== "active") {
      continue;
    }

    const incident = state.incidents.find((item) => item.id === mission.incidentId);
    const asset = state.assets.find((item) => item.id === mission.assetId);
    if (!incident || !asset) {
      continue;
    }

    mission.progress = Math.min(100, mission.progress + Math.floor(Math.random() * 12) + 10);
    mission.etaMinutes = Math.max(1, mission.etaMinutes - 1);
    asset.position = positionAlongRoute(mission.route, Math.min(mission.progress / 72, 1));
    incident.status = mission.progress >= 100 ? "resolved" : "in_progress";
    incident.worklog.unshift(
      mission.progress >= 100
        ? `${asset.name} completed autonomous repair.`
        : `${asset.name} advanced repair mission to ${mission.progress}%.`
    );

    if (mission.progress >= 100) {
      closeMission(mission, incident, asset, `${asset.name} completed repair and safety verification.`);
    }
  }

  state.missions = state.missions.filter((mission) => mission.status !== "completed");
}

function createIncident(template) {
  const sensor = template.sensorId
    ? state.sensors.find((item) => item.id === template.sensorId)
    : resolveSensorForCategory(template.category);
  if (!sensor) {
    return null;
  }

  sensor.status = "alert";
  sensor.reading = sensorReadingFor(template.category);
  sensor.health = Math.max(62, sensor.health - 8);
  sensor.lastUpdatedAt = new Date().toISOString();

  const incident = {
    id: `INC-${incidentCounter++}`,
    title: template.title,
    category: template.category,
    severity: template.severity,
    status: "open",
    detectedAt: new Date().toISOString(),
    location: template.location || sensor.location,
    coordinate: template.coordinate || sensor.position,
    sensorId: sensor.id,
    targetType: template.targetType || sensor.targetType,
    targetId: template.targetId || sensor.targetId,
    summary: template.summary,
    aiAssessment: {
      confidence: template.confidence,
      predictedImpact: template.impact,
      recommendation: template.recommendation
    },
    scenarioKey: template.scenarioKey || template.key || `custom-${template.category}`,
    visualType: template.visualType || defaultVisualType(template.category),
    visualLabel: template.visualLabel || defaultVisualLabel(template.category),
    visualSummary: template.visualSummary || defaultVisualSummary(template.category, template.location || sensor.location),
    publicNote: template.publicNote || template.impact,
    landmarkId: template.landmarkId || null,
    landmarkLabel: template.landmarkLabel || template.location || sensor.location,
    assignedAssetId: null,
    worklog: [
      "Edge anomaly streamed into the digital twin.",
      `AI classified event as ${template.category} with ${template.severity} urgency.`
    ]
  };

  state.incidents.unshift(incident);
  addTimeline("incident", `${incident.id} detected near ${incident.location}.`, incident.id);
  return incident;
}

function autoDispatch(incident) {
  if (!incident || incident.assignedAssetId || incident.status === "resolved") {
    return false;
  }

  const asset = state.assets.find((candidate) => candidate.status === "ready" && capabilityMatch(incident.category, candidate));
  if (!asset) {
    return false;
  }

  incident.assignedAssetId = asset.id;
  incident.status = "in_progress";
  incident.worklog.unshift(`${asset.name} dispatched by AI orchestrator.`);

  asset.status = "busy";
  asset.currentMission = incident.id;

  const route = routeForAsset(asset, incident);
  state.missions.unshift({
    id: `MIS-${missionCounter++}`,
    incidentId: incident.id,
    assetId: asset.id,
    assetType: asset.type,
    objective: incident.aiAssessment.recommendation,
    etaMinutes: Math.floor(Math.random() * 5) + 3,
    progress: Math.floor(Math.random() * 22) + 12,
    status: "active",
    route
  });

  addTimeline("dispatch", `${asset.name} launched toward ${incident.id}.`, incident.id);
  return true;
}

function createPresetIncident(key) {
  const preset = SCENARIO_PRESETS[key];
  if (!preset) {
    return null;
  }

  return createIncident({
    ...preset,
    scenarioKey: preset.key
  });
}

function triggerScenarioPreset(key) {
  const existing = state.incidents.find((incident) => incident.scenarioKey === key && incident.status !== "resolved");
  if (existing) {
    return { incident: existing, reused: true };
  }

  const incident = createPresetIncident(key);
  if (!incident) {
    return null;
  }

  if (state.city.mode === "auto-heal") {
    autoDispatch(incident);
  }

  return { incident, reused: false };
}

function createRandomTemplate() {
  const templates = Object.values(SCENARIO_PRESETS);
  return templates[Math.floor(Math.random() * templates.length)];
}

function simulateTick() {
  if (Date.now() < simulationHoldUntil) {
    return;
  }

  refreshAssetStatus();
  stepMissions();

  for (const sensor of state.sensors) {
    if (sensor.status === "nominal") {
      sensor.health = Math.min(99, sensor.health + 1);
      sensor.lastUpdatedAt = new Date().toISOString();
    }
  }

  const openIncidents = state.incidents.filter((incident) => incident.status !== "resolved");
  if (openIncidents.length < 2 && Math.random() < 0.34) {
    const incident = createIncident(createRandomTemplate());
    if (state.city.mode === "auto-heal") {
      autoDispatch(incident);
    }
  }

  for (const incident of state.incidents.filter((item) => item.status === "open")) {
    if (state.city.mode === "auto-heal") {
      autoDispatch(incident);
    }
  }

  commitAndBroadcast();
}

function serveStaticFile(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end(error.code === "ENOENT" ? "Not Found" : "Server Error");
      return;
    }

    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "text/plain; charset=utf-8" });
    res.end(data);
  });
}

function openStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write(`event: overview\n`);
  res.write(`data: ${JSON.stringify(deriveOverview())}\n\n`);
  streamClients.add(res);

  req.on("close", () => {
    streamClients.delete(res);
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/overview") {
    sendJson(res, 200, deriveOverview());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ai/status") {
    sendJson(res, 200, await getAiStatus());
    return;
  }

  const aiIncidentMatch = url.pathname.match(/^\/api\/ai\/incident\/([^/]+)$/);
  if (req.method === "POST" && aiIncidentMatch) {
    try {
      sendJson(res, 200, await generateAiIncidentAnalysis(aiIncidentMatch[1]));
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ai/briefing") {
    try {
      sendJson(res, 200, await generateAiCityBriefing());
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stream") {
    openStream(req, res);
    return;
  }

  const scenarioMatch = url.pathname.match(/^\/api\/scenarios\/([^/]+)$/);
  if (req.method === "POST" && scenarioMatch) {
    const result = triggerScenarioPreset(scenarioMatch[1]);
    if (!result) {
      sendJson(res, 404, { error: "Scenario preset not found" });
      return;
    }

    if (!result.reused) {
      commitAndBroadcast();
    }

    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/simulate") {
    simulateTick();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    fs.copyFileSync(seedFile, dataFile);
    state = readState();
    eventCounter = nextCounter(state.timeline, "EVT", (state.timeline || []).length + 1);
    incidentCounter = nextCounter(state.incidents, "INC", 4001);
    missionCounter = nextCounter(state.missions, "MIS", 9101);
    simulationHoldUntil = Date.now() + 20000;
    reconcileState();
    commitAndBroadcast();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/mode") {
    const body = await readBody(req);
    if (body.mode !== "auto-heal" && body.mode !== "manual") {
      sendJson(res, 400, { error: "Invalid mode" });
      return;
    }

    state.city.mode = body.mode;
    addTimeline("system", `Operating mode switched to ${body.mode}.`);
    commitAndBroadcast();
    sendJson(res, 200, { ok: true, mode: body.mode });
    return;
  }

  const dispatchMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/dispatch$/);
  if (req.method === "POST" && dispatchMatch) {
    const incident = state.incidents.find((item) => item.id === dispatchMatch[1]);
    if (!incident) {
      sendJson(res, 404, { error: "Incident not found" });
      return;
    }

    const dispatched = autoDispatch(incident);
    if (!dispatched) {
      sendJson(res, 409, { error: "No suitable ready asset available" });
      return;
    }

    commitAndBroadcast();
    sendJson(res, 200, { ok: true });
    return;
  }

  const resolveMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/resolve$/);
  if (req.method === "POST" && resolveMatch) {
    const incident = state.incidents.find((item) => item.id === resolveMatch[1]);
    if (!incident) {
      sendJson(res, 404, { error: "Incident not found" });
      return;
    }

    incident.status = "resolved";
    incident.worklog.unshift("Command center forced manual closure.");

    const mission = state.missions.find((item) => item.incidentId === incident.id);
    if (mission) {
      const asset = state.assets.find((item) => item.id === mission.assetId);
      if (asset) {
        closeMission(mission, incident, asset, "Operator closed incident after manual verification.");
      }
      state.missions = state.missions.filter((item) => item.id !== mission.id);
    } else {
      state.city.resolvedToday += 1;
      const sensor = state.sensors.find((item) => item.id === incident.sensorId);
      if (sensor) {
        sensor.status = "nominal";
        sensor.reading = "Recovered";
        sensor.health = Math.min(99, sensor.health + 6);
        sensor.lastUpdatedAt = new Date().toISOString();
      }
      addTimeline("repair", `${incident.id} manually resolved.`, incident.id);
    }

    commitAndBroadcast();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/incidents") {
    const body = await readBody(req);
    if (!body.title || !body.category || !body.summary) {
      sendJson(res, 400, { error: "Missing required fields" });
      return;
    }

    const targetMap = {
      water: { targetType: "pipe", targetId: "pipe-sector-12" },
      roads: { targetType: "road", targetId: "road-transit-corridor" },
      air: { targetType: "zone", targetId: "zone-east" },
      flood: { targetType: "pipe", targetId: "pipe-river-drain" }
    };

    const incident = createIncident({
      title: body.title,
      category: body.category,
      severity: body.severity || "medium",
      summary: body.summary,
      confidence: Number(body.confidence || 0.78),
      impact: body.impact || "Potential district disruption if untreated.",
      recommendation: body.recommendation || "Dispatch nearest autonomous responder.",
      ...targetMap[body.category]
    });

    if (!incident) {
      sendJson(res, 400, { error: "Unsupported category" });
      return;
    }

    if (state.city.mode === "auto-heal") {
      autoDispatch(incident);
    }

    commitAndBroadcast();
    sendJson(res, 201, { ok: true, incident });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

reconcileState();
writeState();

setInterval(simulateTick, 5000);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStaticFile(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal Server Error" });
  }
});

server.listen(port, host, () => {
  console.log(`Self-Healing Smart City platform running at http://${host}:${port}`);
});
