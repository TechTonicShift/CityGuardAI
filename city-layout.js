const ORIGIN = { lng: 77.5946, lat: 12.9716 };

function point(dx, dy) {
  return [Number((ORIGIN.lng + dx).toFixed(6)), Number((ORIGIN.lat + dy).toFixed(6))];
}

function rectangle(cx, cy, halfWidth, halfHeight) {
  return [[
    point(cx - halfWidth, cy - halfHeight),
    point(cx + halfWidth, cy - halfHeight),
    point(cx + halfWidth, cy + halfHeight),
    point(cx - halfWidth, cy + halfHeight),
    point(cx - halfWidth, cy - halfHeight)
  ]];
}

function polygonFeature(id, coordinates, properties) {
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

function lineFeature(id, coordinates, properties) {
  return {
    type: "Feature",
    id,
    properties: { id, ...properties },
    geometry: {
      type: "LineString",
      coordinates
    }
  };
}

function pointFeature(id, coordinates, properties) {
  return {
    type: "Feature",
    id,
    properties: { id, ...properties },
    geometry: {
      type: "Point",
      coordinates
    }
  };
}

function featureCollection(features) {
  return {
    type: "FeatureCollection",
    features
  };
}

function circlePolygon(center, radiusLng, radiusLat, steps = 32) {
  const coordinates = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps;
    coordinates.push([
      Number((center[0] + Math.cos(angle) * radiusLng).toFixed(6)),
      Number((center[1] + Math.sin(angle) * radiusLat).toFixed(6))
    ]);
  }
  return [coordinates];
}

function routeLength(route) {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    const [x1, y1] = route[index - 1];
    const [x2, y2] = route[index];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

function positionAlongRoute(route, progress) {
  if (!route || !route.length) {
    return null;
  }

  if (route.length === 1 || progress <= 0) {
    return route[0];
  }

  const length = routeLength(route);
  if (!length || progress >= 1) {
    return route[route.length - 1];
  }

  let traversed = 0;
  const target = length * progress;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const segment = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (traversed + segment >= target) {
      const local = (target - traversed) / segment;
      return [
        Number((start[0] + (end[0] - start[0]) * local).toFixed(6)),
        Number((start[1] + (end[1] - start[1]) * local).toFixed(6))
      ];
    }
    traversed += segment;
  }

  return route[route.length - 1];
}

function createGroundRoute(start, end) {
  const viaOne = [start[0], end[1]];
  const viaTwo = [end[0], start[1]];
  return [
    start,
    Math.abs(start[1] - end[1]) > Math.abs(start[0] - end[0]) ? viaOne : viaTwo,
    end
  ];
}

function createDroneRoute(start, end) {
  const midpoint = [
    Number((((start[0] + end[0]) / 2) + 0.00018).toFixed(6)),
    Number((((start[1] + end[1]) / 2) + 0.00012).toFixed(6))
  ];
  return [start, midpoint, end];
}

function buildDistrictLayout() {
  const buildings = [
    polygonFeature("b-civic-hall", rectangle(-0.00055, 0.00020, 0.00018, 0.00014), {
      name: "Civic Hall",
      district: "Civic Core",
      height: 110,
      group: "civic"
    }),
    polygonFeature("b-digital-hospital", rectangle(-0.00010, 0.00028, 0.00016, 0.00012), {
      name: "Digital Hospital",
      district: "Civic Core",
      height: 82,
      group: "health"
    }),
    polygonFeature("b-solar-commons", rectangle(0.00036, 0.00022, 0.00017, 0.00014), {
      name: "Solar Commons",
      district: "Innovation Strip",
      height: 128,
      group: "commercial"
    }),
    polygonFeature("b-hangar", rectangle(0.00082, 0.00058, 0.00016, 0.00013), {
      name: "Aerial Hangar",
      district: "Innovation Strip",
      height: 68,
      group: "infrastructure"
    }),
    polygonFeature("b-public-school", rectangle(-0.00078, -0.00056, 0.00018, 0.00013), {
      name: "Peninsula Public School",
      district: "Utility South",
      height: 48,
      group: "education"
    }),
    polygonFeature("b-water-lab", rectangle(-0.00092, -0.00038, 0.00015, 0.00012), {
      name: "Hydro Lab",
      district: "Utility South",
      height: 74,
      group: "utility"
    }),
    polygonFeature("b-energy-spine", rectangle(-0.00042, -0.00040, 0.00015, 0.00011), {
      name: "Energy Spine",
      district: "Utility South",
      height: 96,
      group: "utility"
    }),
    polygonFeature("b-mobility-bay", rectangle(0.00012, -0.00042, 0.00018, 0.00012), {
      name: "Mobility Bay",
      district: "Transit Yard",
      height: 60,
      group: "mobility"
    }),
    polygonFeature("b-data-orchard", rectangle(0.00064, -0.00038, 0.00016, 0.00012), {
      name: "Data Orchard",
      district: "Transit Yard",
      height: 102,
      group: "data"
    }),
    polygonFeature("b-river-housing", rectangle(-0.00082, 0.00105, 0.00020, 0.00014), {
      name: "River Housing",
      district: "River Edge",
      height: 72,
      group: "residential"
    }),
    polygonFeature("b-green-court", rectangle(-0.00024, 0.00102, 0.00018, 0.00013), {
      name: "Green Court",
      district: "River Edge",
      height: 58,
      group: "residential"
    }),
    polygonFeature("b-east-factory", rectangle(0.00086, 0.00100, 0.00018, 0.00013), {
      name: "East Stack Factory",
      district: "Industrial Belt",
      height: 124,
      group: "industrial"
    }),
    polygonFeature("b-air-scrubbers", rectangle(0.00130, 0.00105, 0.00017, 0.00012), {
      name: "Air Scrubber Plant",
      district: "Industrial Belt",
      height: 90,
      group: "industrial"
    }),
    polygonFeature("b-grid-forge", rectangle(0.00126, 0.00028, 0.00015, 0.00012), {
      name: "Grid Forge",
      district: "Industrial Belt",
      height: 116,
      group: "industrial"
    }),
    polygonFeature("b-portal-tower", rectangle(0.00112, -0.00044, 0.00016, 0.00012), {
      name: "Portal Tower",
      district: "East Link",
      height: 138,
      group: "commercial"
    })
  ];

  const roads = [
    lineFeature("road-river-avenue", [point(-0.00165, 0.00136), point(0.00165, 0.00136)], {
      name: "River Avenue",
      roadType: "arterial"
    }),
    lineFeature("road-central-spine", [point(-0.00175, 0.00005), point(0.00175, 0.00005)], {
      name: "Central Spine",
      roadType: "arterial"
    }),
    lineFeature("road-transit-corridor", [point(-0.00165, -0.00096), point(0.00165, -0.00096)], {
      name: "Transit Corridor",
      roadType: "transit"
    }),
    lineFeature("road-utility-way", [point(-0.00120, -0.00145), point(-0.00120, 0.00155)], {
      name: "Utility Way",
      roadType: "service"
    }),
    lineFeature("road-civic-loop", [point(-0.00008, -0.00145), point(-0.00008, 0.00155)], {
      name: "Civic Loop",
      roadType: "arterial"
    }),
    lineFeature("road-industrial-link", [point(0.00108, -0.00145), point(0.00108, 0.00155)], {
      name: "Industrial Link",
      roadType: "freight"
    })
  ];

  const pipes = [
    lineFeature("pipe-sector-12", [point(-0.00135, -0.00074), point(0.00052, -0.00074)], {
      name: "Sector 12 Main",
      networkType: "water"
    }),
    lineFeature("pipe-civic-main", [point(-0.00062, -0.00120), point(-0.00062, 0.00135)], {
      name: "Civic Pressure Main",
      networkType: "water"
    }),
    lineFeature("pipe-east-ring", [point(0.00054, -0.00018), point(0.00136, -0.00018)], {
      name: "East Ring Feed",
      networkType: "water"
    }),
    lineFeature("pipe-river-drain", [point(-0.00145, 0.00118), point(0.00140, 0.00118)], {
      name: "River Drain Spine",
      networkType: "storm"
    })
  ];

  const zones = [
    polygonFeature("zone-river", rectangle(-0.00055, 0.00108, 0.00125, 0.00048), {
      name: "River Edge",
      zoneType: "residential"
    }),
    polygonFeature("zone-civic", rectangle(-0.00016, 0.00018, 0.00098, 0.00052), {
      name: "Civic Core",
      zoneType: "civic"
    }),
    polygonFeature("zone-south", rectangle(-0.00020, -0.00078, 0.00110, 0.00042), {
      name: "Utility South",
      zoneType: "utility"
    }),
    polygonFeature("zone-east", rectangle(0.00105, 0.00066, 0.00065, 0.00090), {
      name: "Industrial Belt",
      zoneType: "industrial"
    })
  ];

  const waterBodies = [
    polygonFeature("water-river-channel", [[
      point(-0.00185, 0.00148),
      point(0.00185, 0.00148),
      point(0.00185, 0.00178),
      point(-0.00185, 0.00178),
      point(-0.00185, 0.00148)
    ]], {
      name: "Peninsula River",
      kind: "river"
    })
  ];

  const depots = [
    pointFeature("hub-command", point(0.00014, 0.00004), {
      name: "City Orchestrator",
      kind: "command"
    }),
    pointFeature("hub-hangar", point(0.00086, 0.00058), {
      name: "Central Hangar",
      kind: "hangar"
    }),
    pointFeature("hub-utility", point(-0.00094, -0.00092), {
      name: "Utility Depot",
      kind: "depot"
    }),
    pointFeature("hub-mobility", point(0.00008, -0.00108), {
      name: "Mobility Bay",
      kind: "depot"
    }),
    pointFeature("hub-industrial", point(0.00134, 0.00102), {
      name: "Industrial Hub",
      kind: "depot"
    })
  ];

  const landmarks = [
    pointFeature("landmark-school", point(-0.00078, -0.00056), {
      name: "Peninsula Public School",
      kind: "school"
    }),
    pointFeature("landmark-factory", point(0.00086, 0.00100), {
      name: "East Stack Factory",
      kind: "factory"
    }),
    pointFeature("landmark-river", point(-0.00072, 0.00136), {
      name: "River Edge",
      kind: "district"
    }),
    pointFeature("landmark-civic", point(-0.00055, 0.00020), {
      name: "Civic Hall",
      kind: "civic"
    })
  ];

  return {
    meta: {
      name: "NeoGrid Peninsula District",
      center: point(0, 0.00016),
      zoom: 16.7,
      pitch: 58,
      bearing: -34,
      minZoom: 15.8,
      maxZoom: 18.4
    },
    buildings,
    roads,
    pipes,
    zones,
    waterBodies,
    depots,
    landmarks,
    anchors: {
      sensors: {
        "W-204": point(-0.00076, -0.00074),
        "R-118": point(0.00058, -0.00096),
        "A-076": point(0.00118, 0.00108),
        "P-330": point(-0.00108, 0.00118)
      },
      assets: {
        "asset-drone-03": point(0.00086, 0.00058),
        "asset-pipebot-11": point(-0.00094, -0.00092),
        "asset-rover-07": point(0.00008, -0.00108),
        "asset-airsweep-02": point(0.00134, 0.00102)
      },
      scenarios: {
        "burst-main-school": point(-0.00078, -0.00072),
        "pollution-spike-factory": point(0.00092, 0.00106),
        "transit-corridor-fracture": point(0.00054, -0.00096),
        "flash-flood-river-edge": point(-0.00102, 0.00122)
      }
    }
  };
}

module.exports = {
  buildDistrictLayout,
  circlePolygon,
  createDroneRoute,
  createGroundRoute,
  featureCollection,
  lineFeature,
  pointFeature,
  polygonFeature,
  positionAlongRoute,
  routeLength
};
