const state = {
  payload: null,
  selectedIncidentId: null,
  viewMode: "executive",
  map: null,
  mapReady: false,
  mapPopup: null,
  eventSource: null,
  pollTimer: null,
  pulseFrame: null,
  latestTimelineId: null,
  aiStatus: null,
  aiResult: null,
  aiLoading: false,
  hintElement: null
};

const emptyCollection = { type: "FeatureCollection", features: [] };

const els = {
  body: document.body,
  cityHealth: document.getElementById("cityHealth"),
  openIncidents: document.getElementById("openIncidents"),
  resolvedToday: document.getElementById("resolvedToday"),
  cityMode: document.getElementById("cityMode"),
  automationRate: document.getElementById("automationRate"),
  heroStoryTitle: document.getElementById("heroStoryTitle"),
  heroStoryText: document.getElementById("heroStoryText"),
  lastSync: document.getElementById("lastSync"),
  overviewStats: document.getElementById("overviewStats"),
  detailCard: document.getElementById("detailCard"),
  aiCard: document.getElementById("aiCard"),
  citizenBrief: document.getElementById("citizenBrief"),
  incidentList: document.getElementById("incidentList"),
  missionList: document.getElementById("missionList"),
  assetList: document.getElementById("assetList"),
  timelineList: document.getElementById("timelineList"),
  mapStatusTitle: document.getElementById("mapStatusTitle"),
  mapStatusText: document.getElementById("mapStatusText"),
  scenarioPresetList: document.getElementById("scenarioPresetList"),
  scenarioSpotlightTitle: document.getElementById("scenarioSpotlightTitle"),
  scenarioSpotlightText: document.getElementById("scenarioSpotlightText"),
  scenarioSpotlightMeta: document.getElementById("scenarioSpotlightMeta"),
  refreshBtn: document.getElementById("refreshBtn"),
  simulateBtn: document.getElementById("simulateBtn"),
  modeBtn: document.getElementById("modeBtn"),
  resetBtn: document.getElementById("resetBtn"),
  recenterBtn: document.getElementById("recenterBtn"),
  aiIncidentBtn: document.getElementById("aiIncidentBtn"),
  aiCityBtn: document.getElementById("aiCityBtn"),
  incidentForm: document.getElementById("incidentForm"),
  formStatus: document.getElementById("formStatus"),
  mapCanvas: document.getElementById("mapCanvas"),
  modeTabs: Array.from(document.querySelectorAll(".mode-tab[data-view-mode]"))
};

function niceTime(value) {
  return new Date(value).toLocaleString();
}

function titleCase(value) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function getSelectedIncident(payload = state.payload) {
  if (!payload) {
    return null;
  }
  return payload.incidents.find((incident) => incident.id === state.selectedIncidentId) || null;
}

function ensureSelectedIncident(payload) {
  if (!payload || !payload.incidents.length) {
    state.selectedIncidentId = null;
    return;
  }

  const existing = payload.incidents.find((incident) => incident.id === state.selectedIncidentId);
  if (existing) {
    return;
  }

  const preferred = payload.incidents.find((incident) => incident.status !== "resolved");
  state.selectedIncidentId = (preferred || payload.incidents[0]).id;
}

function setStatusCard(eventEntry) {
  if (!eventEntry) {
    return;
  }

  const label = eventEntry.kind === "incident"
    ? "Problem detected"
    : eventEntry.kind === "dispatch"
      ? "Repair launched"
      : eventEntry.kind === "repair"
        ? "Repair verified"
        : "System update";

  els.mapStatusTitle.textContent = label;
  els.mapStatusText.textContent = eventEntry.message;
}

function applyViewMode() {
  els.body.dataset.viewMode = state.viewMode;
  for (const tab of els.modeTabs) {
    tab.classList.toggle("is-active", tab.dataset.viewMode === state.viewMode);
  }
}

function scenarioCueText(incident) {
  if (!incident) {
    return "";
  }

  if (incident.visualType === "water_burst") {
    return `Watch the pressure bloom under ${incident.landmarkLabel || incident.location} as PipeBot isolates the main.`;
  }
  if (incident.visualType === "pollution_plume") {
    return `The drifting plume shows where emissions are moving while the drone maps the source near ${incident.landmarkLabel || incident.location}.`;
  }
  if (incident.visualType === "flood_surge") {
    return `The flood pocket and front line show where runoff is accumulating and where it will push next near ${incident.landmarkLabel || incident.location}.`;
  }
  return `The highlighted lane and fracture seams show the section under repair on ${incident.location}.`;
}

function scenarioMetaTags(incident) {
  if (!incident) {
    return [];
  }

  return [
    incident.visualLabel,
    incident.landmarkLabel || incident.location,
    `${titleCase(incident.severity)} priority`
  ];
}

function renderHeroStory(payload) {
  const activeIncident = payload.incidents.find((incident) => incident.status !== "resolved");
  const latestEvent = payload.timeline[0];

  if (state.viewMode === "citizen") {
    if (activeIncident) {
      els.heroStoryTitle.textContent = `${activeIncident.title} is being handled now.`;
      els.heroStoryText.textContent = `${activeIncident.publicNote} ${scenarioCueText(activeIncident)}`;
    } else {
      els.heroStoryTitle.textContent = "All essential services are operating normally.";
      els.heroStoryText.textContent = "The district has no active issues affecting residents right now.";
    }
    return;
  }

  if (activeIncident) {
    els.heroStoryTitle.textContent = `${activeIncident.title}`;
    els.heroStoryText.textContent = `${activeIncident.aiAssessment.predictedImpact} ${scenarioCueText(activeIncident)} The system is responding ${activeIncident.assignedAssetId ? "with an assigned asset" : "and preparing a response"} now.`;
    return;
  }

  if (latestEvent) {
    els.heroStoryTitle.textContent = "The city is stable.";
    els.heroStoryText.textContent = latestEvent.message;
  }
}

function renderScenarioPresets(payload) {
  const presets = payload.scenarios ? payload.scenarios.presets : [];
  const activeKeys = new Set(payload.incidents
    .filter((incident) => incident.status !== "resolved")
    .map((incident) => incident.scenarioKey));

  els.scenarioPresetList.innerHTML = presets.map((preset) => `
    <button
      class="preset-card ${activeKeys.has(preset.key) ? "is-live" : ""}"
      type="button"
      data-scenario-key="${preset.key}"
    >
      <span class="badge">${preset.label}</span>
      <strong>${titleCase(preset.category)} / ${titleCase(preset.severity)}</strong>
      <p>${preset.description}</p>
      <small>${preset.visualLabel} near ${preset.landmarkLabel}</small>
    </button>
  `).join("");
}

function renderScenarioSpotlight(payload) {
  const incident = getSelectedIncident(payload) || payload.incidents.find((item) => item.status !== "resolved");
  if (!incident) {
    els.scenarioSpotlightTitle.textContent = "Waiting for a scenario...";
    els.scenarioSpotlightText.textContent = "Launch a preset or select an incident to see what the city is visualizing.";
    els.scenarioSpotlightMeta.innerHTML = "";
    return;
  }

  els.scenarioSpotlightTitle.textContent = incident.visualLabel || incident.title;
  els.scenarioSpotlightText.textContent = incident.visualSummary || scenarioCueText(incident);
  els.scenarioSpotlightMeta.innerHTML = scenarioMetaTags(incident)
    .map((tag) => `<span class="pill">${tag}</span>`)
    .join("");
}

function renderOverview(payload) {
  const { city, metrics } = payload;
  els.cityHealth.textContent = `${city.health}%`;
  els.openIncidents.textContent = String(metrics.openIncidents);
  els.resolvedToday.textContent = String(city.resolvedToday);
  els.cityMode.textContent = city.mode === "auto-heal" ? "On" : "Manual only";
  els.automationRate.textContent = `${metrics.automatedResolutionRate}%`;
  els.modeBtn.textContent = city.mode === "auto-heal" ? "Pause Automatic Response" : "Enable Automatic Response";
  els.lastSync.textContent = `Last sync ${new Date().toLocaleTimeString()}`;

  const cards = [
    {
      label: "Ready assets",
      value: metrics.readyAssets,
      meta: "Robots and drones available for the next issue."
    },
    {
      label: "Active missions",
      value: metrics.activeMissions,
      meta: "Repairs or inspections currently underway."
    },
    {
      label: "Sensor reliability",
      value: `${metrics.averageSensorHealth}%`,
      meta: "How healthy the district sensing grid is right now."
    },
    {
      label: "Demo district",
      value: city.districtName || "Peninsula District",
      meta: "The zone currently mirrored by the digital twin."
    }
  ];

  els.overviewStats.innerHTML = cards.map((card) => `
    <article class="proof-card">
      <span class="badge">${card.label}</span>
      <strong>${card.value}</strong>
      <p>${card.meta}</p>
    </article>
  `).join("");

  renderHeroStory(payload);
  renderScenarioPresets(payload);
  renderScenarioSpotlight(payload);
}

function renderAiCard() {
  const configuredModel = state.payload && state.payload.ai ? state.payload.ai.model : "qwen3-coder:480b-cloud";
  const status = state.aiStatus;
  const result = state.aiResult;

  if (state.aiLoading) {
    els.aiCard.innerHTML = `
      <strong>Generating explanation...</strong>
      <p>The City Copilot is querying <code>${configuredModel}</code> to explain the current situation.</p>
    `;
    return;
  }

  if (!status) {
    els.aiCard.innerHTML = `
      <strong>Checking City Copilot...</strong>
      <p>The app is probing the local Ollama runtime and AI model path.</p>
    `;
    return;
  }

  const intro = status.available
    ? "The AI copilot is available to explain why the city prioritized a problem and how it expects the next few minutes to unfold."
    : (status.error || status.hint);

  const sections = [];
  if (result && result.scope === "incident") {
    sections.push(`
      <div class="citizen-item">
        <strong>Why the system acted this way</strong>
        <p>${result.content.summary}</p>
        <p><strong>Recommended action</strong> ${result.content.dispatch_recommendation}</p>
        <p><strong>Why it matters</strong> ${result.content.why_this_matters}</p>
        <p><strong>Why this asset</strong> ${result.content.why_this_asset}</p>
        <ul>${result.content.repair_steps.map((step) => `<li>${step}</li>`).join("")}</ul>
        <p><strong>Stakeholder update</strong> ${result.content.stakeholder_update}</p>
      </div>
    `);
  }

  if (result && result.scope === "city") {
    sections.push(`
      <div class="citizen-item">
        <strong>Executive city brief</strong>
        <p>${result.content.executive_summary}</p>
        <p><strong>Current posture</strong> ${result.content.city_posture}</p>
        <p><strong>Asset readiness</strong> ${result.content.asset_readiness}</p>
        <ul>${result.content.next_actions.map((step) => `<li>${step}</li>`).join("")}</ul>
      </div>
    `);
  }

  els.aiCard.innerHTML = `
    <div class="detail-meta">
      <div>
        <strong>City Copilot</strong>
        <p>${configuredModel}</p>
      </div>
      <span class="badge ${status.available ? "" : "warning"}">${status.available ? "connected" : "unavailable"}</span>
    </div>
    <p>${intro}</p>
    <p><strong>Runtime</strong> ${status.baseUrl}</p>
    ${sections.join("") || "<p>No explanation generated yet. Use the buttons below to ask the AI to explain an incident or brief the whole city.</p>"}
  `;
}

function renderDetail(payload) {
  const incident = getSelectedIncident(payload);
  if (!incident) {
    els.detailCard.innerHTML = `
      <strong>No active problem selected</strong>
      <p>Choose an item from the response queue or click a problem directly on the map.</p>
    `;
    return;
  }

  const statusBadge = incident.status !== "resolved"
    ? `<span class="badge warning">${titleCase(incident.status)}</span>`
    : `<span class="badge">${titleCase(incident.status)}</span>`;

  els.detailCard.innerHTML = `
    <div class="detail-meta">
      <div>
        <strong>${incident.title}</strong>
        <p>${incident.location}</p>
      </div>
      ${statusBadge}
    </div>
    <p>${incident.summary}</p>
    <p><strong>Why this matters</strong> ${incident.aiAssessment.predictedImpact}</p>
    <p><strong>What the map is showing</strong> ${incident.visualSummary}</p>
    <p><strong>Public note</strong> ${incident.publicNote}</p>
    <p><strong>AI confidence</strong> ${(incident.aiAssessment.confidence * 100).toFixed(0)}%</p>
    <p><strong>Recommended city action</strong> ${incident.aiAssessment.recommendation}</p>
    <ul class="incident-log">
      ${incident.worklog.slice(0, 4).map((item) => `<li>${item}</li>`).join("")}
    </ul>
    <div class="action-row">
      <button class="action-btn" data-action="focus" data-id="${incident.id}">Focus On Map</button>
      ${incident.status === "open" ? `<button class="action-btn" data-action="dispatch" data-id="${incident.id}">Send Asset</button>` : ""}
      ${incident.status !== "resolved" ? `<button class="action-btn" data-action="resolve" data-id="${incident.id}">Mark As Fixed</button>` : ""}
    </div>
  `;
}

function renderCitizenBrief(payload) {
  const active = payload.incidents.filter((incident) => incident.status !== "resolved");
  if (!active.length) {
    els.citizenBrief.innerHTML = `
      <div class="citizen-item">
        <strong>Everything looks normal</strong>
        <p>There are no active district issues affecting public services right now.</p>
      </div>
    `;
    return;
  }

  els.citizenBrief.innerHTML = `
    <div class="citizen-item">
      <strong>Current public notice</strong>
      <p>${active[0].title} is the most important active issue in the district.</p>
      <p>${active[0].publicNote}</p>
      <ul>
        ${active.slice(0, 3).map((incident) => `<li>${incident.location}: ${incident.aiAssessment.predictedImpact}</li>`).join("")}
      </ul>
      <p>City teams are already responding and updates will continue as repairs are verified.</p>
    </div>
  `;
}

function renderIncidents(payload) {
  els.incidentList.innerHTML = payload.incidents.map((incident) => `
    <article class="queue-card ${incident.id === state.selectedIncidentId ? "selected" : ""}" data-incident-id="${incident.id}">
      <div class="row">
        <div>
          <strong>${incident.title}</strong>
          <p>${incident.location}</p>
        </div>
        <span class="badge ${incident.status !== "resolved" ? "warning" : ""}">${titleCase(incident.status)}</span>
      </div>
      <div class="row">
        <span class="pill">${incident.category} / ${incident.severity}</span>
        <span>${niceTime(incident.detectedAt)}</span>
      </div>
      <p>${incident.aiAssessment.predictedImpact}</p>
    </article>
  `).join("");
}

function renderMissions(payload) {
  if (!payload.missions.length) {
    els.missionList.innerHTML = `
      <article class="mission-card">
        <strong>No active jobs</strong>
        <p>The city is waiting for the next autonomous repair or inspection task.</p>
      </article>
    `;
    return;
  }

  els.missionList.innerHTML = payload.missions.map((mission) => {
    const asset = payload.assets.find((item) => item.id === mission.assetId);
    const incident = payload.incidents.find((item) => item.id === mission.incidentId);
    return `
      <article class="mission-card">
        <div class="row">
          <strong>${asset ? asset.name : mission.assetId}</strong>
          <span class="badge">${titleCase(mission.status)}</span>
        </div>
        <p>${incident ? incident.title : mission.incidentId}</p>
        <p>${mission.objective}</p>
        <div class="row">
          <span class="pill">ETA ${mission.etaMinutes} min</span>
          <span>${mission.progress}% complete</span>
        </div>
        <div class="progress"><span style="width:${mission.progress}%"></span></div>
      </article>
    `;
  }).join("");
}

function renderAssets(payload) {
  els.assetList.innerHTML = payload.assets.map((asset) => `
    <article class="asset-card">
      <div class="row">
        <strong>${asset.name}</strong>
        <span class="badge ${asset.status !== "ready" ? "warning" : ""}">${titleCase(asset.status)}</span>
      </div>
      <p>${asset.location}</p>
      <p>${asset.capabilities.join(", ")}</p>
      <div class="row">
        <span class="pill">Battery ${asset.battery}%</span>
        <span>${asset.currentMission || "Idle"}</span>
      </div>
    </article>
  `).join("");
}

function renderTimeline(payload) {
  els.timelineList.innerHTML = payload.timeline.map((entry) => `
    <article class="timeline-item" ${entry.incidentId ? `data-focus-id="${entry.incidentId}"` : ""}>
      <div class="timeline-head">
        <strong>${titleCase(entry.kind)}</strong>
        <span>${niceTime(entry.time)}</span>
      </div>
      <p>${entry.message}</p>
    </article>
  `).join("");
}

function render(payload) {
  state.payload = payload;
  ensureSelectedIncident(payload);
  renderOverview(payload);
  renderDetail(payload);
  renderAiCard();
  renderCitizenBrief(payload);
  renderIncidents(payload);
  renderMissions(payload);
  renderAssets(payload);
  renderTimeline(payload);

  if (payload.timeline[0] && payload.timeline[0].id !== state.latestTimelineId) {
    state.latestTimelineId = payload.timeline[0].id;
    setStatusCard(payload.timeline[0]);
  }
}

function selectedSourceData() {
  const incident = getSelectedIncident();
  if (!incident) {
    return emptyCollection;
  }

  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { id: incident.id },
      geometry: {
        type: "Point",
        coordinates: incident.coordinate
      }
    }]
  };
}

function popupForFeature(kind, properties) {
  if (kind === "incident") {
    return `
      <strong>${properties.title}</strong>
      <p>${titleCase(properties.category)} issue · ${titleCase(properties.severity)}</p>
    `;
  }
  if (kind === "asset") {
    return `
      <strong>${properties.name}</strong>
      <p>${titleCase(properties.type)} · Battery ${properties.battery}% · ${titleCase(properties.status)}</p>
    `;
  }
  if (kind === "building") {
    return `
      <strong>${properties.name}</strong>
      <p>${titleCase(properties.group)} building · ${properties.district}</p>
    `;
  }
  if (kind === "landmark") {
    return `
      <strong>${properties.name}</strong>
      <p>${titleCase(properties.kind)} landmark</p>
    `;
  }
  if (kind === "water") {
    return `
      <strong>${properties.title}</strong>
      <p>Pressure bloom footprint</p>
    `;
  }
  if (kind === "pollution") {
    return `
      <strong>${properties.title}</strong>
      <p>Pollution plume drift area</p>
    `;
  }
  if (kind === "flood") {
    return `
      <strong>${properties.title}</strong>
      <p>Flood spread and runoff front</p>
    `;
  }
  if (kind === "road") {
    return `
      <strong>${properties.title}</strong>
      <p>Road fracture envelope</p>
    `;
  }
  return `
    <strong>${properties.name}</strong>
    <p>${titleCase(properties.category)} sensor · ${titleCase(properties.status)}</p>
  `;
}

function attachHoverPopup(map, layerId, kind) {
  map.on("mousemove", layerId, (event) => {
    const feature = event.features && event.features[0];
    if (!feature || !state.mapPopup) {
      return;
    }

    state.map.getCanvas().style.cursor = "pointer";
    state.mapPopup
      .setLngLat(event.lngLat)
      .setHTML(popupForFeature(kind, feature.properties))
      .addTo(state.map);
  });

  map.on("mouseleave", layerId, () => {
    state.map.getCanvas().style.cursor = "";
    if (state.mapPopup) {
      state.mapPopup.remove();
    }
  });
}

function addMapLayers(map) {
  map.addSource("waterBodies", { type: "geojson", data: emptyCollection });
  map.addSource("zones", { type: "geojson", data: emptyCollection });
  map.addSource("roads", { type: "geojson", data: emptyCollection });
  map.addSource("pipes", { type: "geojson", data: emptyCollection });
  map.addSource("buildings", { type: "geojson", data: emptyCollection });
  map.addSource("depots", { type: "geojson", data: emptyCollection });
  map.addSource("landmarks", { type: "geojson", data: emptyCollection });
  map.addSource("incidentAreas", { type: "geojson", data: emptyCollection });
  map.addSource("waterBursts", { type: "geojson", data: emptyCollection });
  map.addSource("waterSprays", { type: "geojson", data: emptyCollection });
  map.addSource("pollutionPlumes", { type: "geojson", data: emptyCollection });
  map.addSource("pollutionParticles", { type: "geojson", data: emptyCollection });
  map.addSource("floodExtents", { type: "geojson", data: emptyCollection });
  map.addSource("floodFronts", { type: "geojson", data: emptyCollection });
  map.addSource("roadEnvelopes", { type: "geojson", data: emptyCollection });
  map.addSource("roadFractures", { type: "geojson", data: emptyCollection });
  map.addSource("routes", { type: "geojson", data: emptyCollection });
  map.addSource("sensors", { type: "geojson", data: emptyCollection });
  map.addSource("incidents", { type: "geojson", data: emptyCollection });
  map.addSource("assets", { type: "geojson", data: emptyCollection });
  map.addSource("selectedIncident", { type: "geojson", data: emptyCollection });

  map.addLayer({
    id: "water-bodies-fill",
    type: "fill",
    source: "waterBodies",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.78
    }
  });

  map.addLayer({
    id: "zones-fill",
    type: "fill",
    source: "zones",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.18
    }
  });

  map.addLayer({
    id: "roads-line",
    type: "line",
    source: "roads",
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["get", "width"],
      "line-opacity": 0.8
    }
  });

  map.addLayer({
    id: "pipes-line",
    type: "line",
    source: "pipes",
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["get", "width"],
      "line-opacity": 0.88,
      "line-dasharray": [1.2, 1.2]
    }
  });

  map.addLayer({
    id: "road-envelopes-fill",
    type: "fill",
    source: "roadEnvelopes",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.18
    }
  });

  map.addLayer({
    id: "flood-extents-fill",
    type: "fill",
    source: "floodExtents",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.18
    }
  });

  map.addLayer({
    id: "pollution-plumes-fill",
    type: "fill",
    source: "pollutionPlumes",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.16
    }
  });

  map.addLayer({
    id: "water-bursts-fill",
    type: "fill",
    source: "waterBursts",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.2
    }
  });

  map.addLayer({
    id: "incident-areas-fill",
    type: "fill",
    source: "incidentAreas",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.14
    }
  });

  map.addLayer({
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "buildings",
    paint: {
      "fill-extrusion-color": ["get", "color"],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.92
    }
  });

  map.addLayer({
    id: "landmarks-points",
    type: "circle",
    source: "landmarks",
    paint: {
      "circle-color": "#fff6df",
      "circle-radius": 4.5,
      "circle-stroke-color": "#1e1d1a",
      "circle-stroke-width": 1.1
    }
  });

  map.addLayer({
    id: "road-fractures-line",
    type: "line",
    source: "roadFractures",
    paint: {
      "line-color": ["get", "color"],
      "line-width": 4.5,
      "line-opacity": 0.92
    }
  });

  map.addLayer({
    id: "water-sprays-line",
    type: "line",
    source: "waterSprays",
    paint: {
      "line-color": ["get", "color"],
      "line-width": 3,
      "line-opacity": 0.9,
      "line-dasharray": [0.6, 1.2]
    }
  });

  map.addLayer({
    id: "flood-fronts-line",
    type: "line",
    source: "floodFronts",
    paint: {
      "line-color": ["get", "color"],
      "line-width": 3,
      "line-opacity": 0.94,
      "line-dasharray": [1.1, 1.1]
    }
  });

  map.addLayer({
    id: "routes-line",
    type: "line",
    source: "routes",
    paint: {
      "line-color": ["get", "color"],
      "line-width": 4,
      "line-opacity": 0.9
    }
  });

  map.addLayer({
    id: "depots-points",
    type: "circle",
    source: "depots",
    paint: {
      "circle-color": "#6b7280",
      "circle-radius": 4.5,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1
    }
  });

  map.addLayer({
    id: "sensors-points",
    type: "circle",
    source: "sensors",
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "status"], "alert"],
        "#ff8a4d",
        "#0f766e"
      ],
      "circle-radius": 5.5,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.4
    }
  });

  map.addLayer({
    id: "pollution-particles",
    type: "circle",
    source: "pollutionParticles",
    paint: {
      "circle-color": ["get", "color"],
      "circle-opacity": 0.55,
      "circle-radius": 6.5,
      "circle-stroke-color": "rgba(255, 255, 255, 0.7)",
      "circle-stroke-width": 0.8
    }
  });

  map.addLayer({
    id: "incidents-glow",
    type: "circle",
    source: "incidents",
    paint: {
      "circle-color": ["get", "color"],
      "circle-opacity": 0.16,
      "circle-radius": 18
    }
  });

  map.addLayer({
    id: "incidents-core",
    type: "circle",
    source: "incidents",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": [
        "case",
        ["==", ["get", "severity"], "critical"], 12,
        ["==", ["get", "severity"], "high"], 10,
        8
      ],
      "circle-stroke-color": "#fffdf7",
      "circle-stroke-width": 1.5
    }
  });

  map.addLayer({
    id: "assets-points",
    type: "circle",
    source: "assets",
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": [
        "case",
        ["==", ["get", "type"], "drone"], 8,
        6.5
      ],
      "circle-stroke-color": "#fffdf7",
      "circle-stroke-width": 1.4
    }
  });

  map.addLayer({
    id: "selected-incident-ring",
    type: "circle",
    source: "selectedIncident",
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#1e1d1a",
      "circle-stroke-width": 2.2,
      "circle-radius": 18
    }
  });

  map.on("click", "incidents-core", (event) => {
    const feature = event.features && event.features[0];
    if (!feature) {
      return;
    }
    focusIncident(feature.properties.id, true);
  });

  attachHoverPopup(map, "incidents-core", "incident");
  attachHoverPopup(map, "assets-points", "asset");
  attachHoverPopup(map, "sensors-points", "sensor");
  attachHoverPopup(map, "buildings-3d", "building");
  attachHoverPopup(map, "landmarks-points", "landmark");
  attachHoverPopup(map, "water-bursts-fill", "water");
  attachHoverPopup(map, "pollution-plumes-fill", "pollution");
  attachHoverPopup(map, "flood-extents-fill", "flood");
  attachHoverPopup(map, "road-envelopes-fill", "road");
}

function updateMapSources(payload) {
  if (!state.mapReady || !state.map) {
    return;
  }

  state.map.getSource("waterBodies").setData(payload.map.waterBodies);
  state.map.getSource("zones").setData(payload.map.zones);
  state.map.getSource("roads").setData(payload.map.roads);
  state.map.getSource("pipes").setData(payload.map.pipes);
  state.map.getSource("buildings").setData(payload.map.buildings);
  state.map.getSource("depots").setData(payload.map.depots);
  state.map.getSource("landmarks").setData(payload.map.landmarks);
  state.map.getSource("incidentAreas").setData(payload.map.incidentAreas);
  state.map.getSource("waterBursts").setData(payload.map.waterBursts);
  state.map.getSource("waterSprays").setData(payload.map.waterSprays);
  state.map.getSource("pollutionPlumes").setData(payload.map.pollutionPlumes);
  state.map.getSource("pollutionParticles").setData(payload.map.pollutionParticles);
  state.map.getSource("floodExtents").setData(payload.map.floodExtents);
  state.map.getSource("floodFronts").setData(payload.map.floodFronts);
  state.map.getSource("roadEnvelopes").setData(payload.map.roadEnvelopes);
  state.map.getSource("roadFractures").setData(payload.map.roadFractures);
  state.map.getSource("routes").setData(payload.map.routes);
  state.map.getSource("sensors").setData(payload.map.sensors);
  state.map.getSource("incidents").setData(payload.map.incidents);
  state.map.getSource("assets").setData(payload.map.assets);
  state.map.getSource("selectedIncident").setData(selectedSourceData());
}

function initMap(payload) {
  if (state.map || !window.maplibregl) {
    if (!window.maplibregl) {
      els.mapStatusTitle.textContent = "Map engine unavailable";
      els.mapStatusText.textContent = "MapLibre could not be loaded. The city narrative remains available.";
    }
    return;
  }

  const view = payload.map.view;
  state.map = new maplibregl.Map({
    container: "mapCanvas",
    style: {
      version: 8,
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: {
            "background-color": "#d7e4ec"
          }
        }
      ]
    },
    center: view.center,
    zoom: view.zoom,
    pitch: view.pitch,
    bearing: view.bearing,
    minZoom: view.minZoom,
    maxZoom: view.maxZoom,
    antialias: true
  });

  state.mapPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 12
  });

  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");

  state.map.on("load", () => {
    state.mapReady = true;
    addMapLayers(state.map);
    updateMapSources(payload);
    animateMapPulse();
  });
}

function animateMapPulse() {
  if (!state.map || !state.mapReady) {
    state.pulseFrame = window.requestAnimationFrame(animateMapPulse);
    return;
  }

  const phase = (Date.now() % 1600) / 1600;
  const pulse = 14 + Math.sin(phase * Math.PI * 2) * 4;
  const glow = 24 + Math.sin(phase * Math.PI * 2) * 6;
  const waterOpacity = 0.14 + Math.abs(Math.sin(phase * Math.PI * 2)) * 0.12;
  const plumeOpacity = 0.12 + Math.abs(Math.sin(phase * Math.PI * 2 + 0.7)) * 0.08;
  const floodOpacity = 0.12 + Math.abs(Math.sin(phase * Math.PI * 2 + 1.2)) * 0.1;

  state.map.setPaintProperty("incidents-core", "circle-radius", [
    "case",
    ["==", ["get", "severity"], "critical"], pulse + 4,
    ["==", ["get", "severity"], "high"], pulse + 1,
    pulse - 1
  ]);
  state.map.setPaintProperty("incidents-glow", "circle-radius", glow);
  state.map.setPaintProperty("incidents-glow", "circle-opacity", 0.1 + Math.abs(Math.sin(phase * Math.PI * 2)) * 0.12);
  state.map.setPaintProperty("selected-incident-ring", "circle-radius", pulse + 8);
  state.map.setPaintProperty("water-bursts-fill", "fill-opacity", waterOpacity);
  state.map.setPaintProperty("water-sprays-line", "line-opacity", 0.72 + Math.abs(Math.sin(phase * Math.PI * 2)) * 0.22);
  state.map.setPaintProperty("pollution-plumes-fill", "fill-opacity", plumeOpacity);
  state.map.setPaintProperty("pollution-particles", "circle-radius", 4.5 + Math.abs(Math.sin(phase * Math.PI * 2 + 0.4)) * 3.2);
  state.map.setPaintProperty("pollution-particles", "circle-opacity", 0.4 + Math.abs(Math.sin(phase * Math.PI * 2 + 0.9)) * 0.28);
  state.map.setPaintProperty("flood-extents-fill", "fill-opacity", floodOpacity);
  state.map.setPaintProperty("flood-fronts-line", "line-opacity", 0.64 + Math.abs(Math.sin(phase * Math.PI * 2)) * 0.24);
  state.map.setPaintProperty("road-envelopes-fill", "fill-opacity", 0.11 + Math.abs(Math.sin(phase * Math.PI * 2 + 1.4)) * 0.08);
  state.map.setPaintProperty("road-fractures-line", "line-opacity", 0.7 + Math.abs(Math.sin(phase * Math.PI * 2 + 0.2)) * 0.22);
  state.pulseFrame = window.requestAnimationFrame(animateMapPulse);
}

function focusIncident(incidentId, fly = false) {
  if (!state.payload) {
    return;
  }

  const incident = state.payload.incidents.find((item) => item.id === incidentId);
  if (!incident) {
    return;
  }

  state.selectedIncidentId = incidentId;
  renderDetail(state.payload);
  renderIncidents(state.payload);
  renderScenarioSpotlight(state.payload);

  if (state.mapReady) {
    state.map.getSource("selectedIncident").setData(selectedSourceData());
    if (fly) {
      state.map.flyTo({
        center: incident.coordinate,
        zoom: 17.65,
        pitch: 64,
        bearing: -40,
        speed: 0.75,
        curve: 1.2,
        essential: true
      });
    }
  }
}

function recenterMap() {
  if (!state.payload || !state.mapReady) {
    return;
  }

  const view = state.payload.map.view;
  state.map.easeTo({
    center: view.center,
    zoom: view.zoom,
    pitch: view.pitch,
    bearing: view.bearing,
    duration: 1200
  });
}

function handleOverview(payload, shouldAutoFocus) {
  const previousTopIncident = state.payload && state.payload.incidents[0] ? state.payload.incidents[0].id : null;
  render(payload);
  initMap(payload);
  updateMapSources(payload);

  if (shouldAutoFocus && payload.incidents[0] && payload.incidents[0].id !== previousTopIncident) {
    focusIncident(payload.incidents[0].id, true);
  } else if (state.selectedIncidentId) {
    focusIncident(state.selectedIncidentId, false);
  }
}

async function refresh() {
  const payload = await api("/api/overview");
  handleOverview(payload, false);
}

async function refreshAiStatus() {
  state.aiStatus = await api("/api/ai/status");
  renderAiCard();
}

function connectStream() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource("/api/stream");
  state.eventSource.addEventListener("overview", (event) => {
    const payload = JSON.parse(event.data);
    handleOverview(payload, true);
  });

  state.eventSource.onerror = () => {
    els.mapStatusTitle.textContent = "Live stream interrupted";
    els.mapStatusText.textContent = "Switching to slower background refresh until the live stream recovers.";
    if (!state.pollTimer) {
      state.pollTimer = window.setInterval(() => {
        refresh().catch(() => {});
      }, 7000);
    }
  };
}

async function toggleMode() {
  if (!state.payload) {
    return;
  }
  const nextMode = state.payload.city.mode === "auto-heal" ? "manual" : "auto-heal";
  await api("/api/mode", {
    method: "POST",
    body: JSON.stringify({ mode: nextMode })
  });
}

async function resetDemo() {
  await api("/api/reset", { method: "POST" });
  state.aiResult = null;
  els.formStatus.textContent = "Scenario reset.";
}

async function launchScenarioPreset(key) {
  const response = await api(`/api/scenarios/${key}`, { method: "POST" });
  state.selectedIncidentId = response.incident.id;
  await refresh();
  focusIncident(response.incident.id, true);
}

async function generateIncidentAi() {
  const incident = getSelectedIncident();
  if (!incident) {
    return;
  }
  state.aiLoading = true;
  renderAiCard();
  try {
    state.aiResult = await api(`/api/ai/incident/${incident.id}`, { method: "POST" });
  } finally {
    state.aiLoading = false;
    renderAiCard();
  }
}

async function generateCityAi() {
  state.aiLoading = true;
  renderAiCard();
  try {
    state.aiResult = await api("/api/ai/briefing", { method: "POST" });
  } finally {
    state.aiLoading = false;
    renderAiCard();
  }
}

async function handleDetailAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === "focus") {
    focusIncident(id, true);
    return;
  }

  const path = action === "dispatch"
    ? `/api/incidents/${id}/dispatch`
    : `/api/incidents/${id}/resolve`;
  await api(path, { method: "POST" });
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const formData = new FormData(els.incidentForm);
  const payload = Object.fromEntries(formData.entries());
  await api("/api/incidents", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  els.formStatus.textContent = "Scenario created and sent to the city.";
  els.incidentForm.reset();
  els.incidentForm.elements.confidence.value = "0.84";
}

function handleIncidentClick(event) {
  const card = event.target.closest("[data-incident-id]");
  if (!card) {
    return;
  }
  focusIncident(card.dataset.incidentId, true);
}

function handleTimelineClick(event) {
  const item = event.target.closest("[data-focus-id]");
  if (!item) {
    return;
  }
  focusIncident(item.dataset.focusId, true);
}

function handleScenarioPresetClick(event) {
  const button = event.target.closest("[data-scenario-key]");
  if (!button) {
    return null;
  }
  return launchScenarioPreset(button.dataset.scenarioKey);
}

function initHints() {
  state.hintElement = document.createElement("div");
  state.hintElement.className = "hint-tooltip";
  document.body.appendChild(state.hintElement);

  const showHint = (target) => {
    const title = target.dataset.hintTitle;
    const text = target.dataset.hintText;
    if (!title || !text) {
      return;
    }

    state.hintElement.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
    state.hintElement.classList.add("is-visible");

    const rect = target.getBoundingClientRect();
    const tooltipRect = state.hintElement.getBoundingClientRect();
    const top = Math.max(12, rect.top - tooltipRect.height - 10);
    const left = Math.min(
      window.innerWidth - tooltipRect.width - 12,
      Math.max(12, rect.left + rect.width / 2 - tooltipRect.width / 2)
    );

    state.hintElement.style.top = `${top}px`;
    state.hintElement.style.left = `${left}px`;
  };

  const hideHint = () => {
    state.hintElement.classList.remove("is-visible");
  };

  document.addEventListener("mouseover", (event) => {
    const trigger = event.target.closest(".hint-trigger");
    if (trigger) {
      showHint(trigger);
    }
  });

  document.addEventListener("mouseout", (event) => {
    const trigger = event.target.closest(".hint-trigger");
    if (trigger) {
      hideHint();
    }
  });

  document.addEventListener("focusin", (event) => {
    const trigger = event.target.closest(".hint-trigger");
    if (trigger) {
      showHint(trigger);
    }
  });

  document.addEventListener("focusout", (event) => {
    const trigger = event.target.closest(".hint-trigger");
    if (trigger) {
      hideHint();
    }
  });

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(".hint-trigger");
    if (trigger) {
      event.preventDefault();
      if (state.hintElement.classList.contains("is-visible")) {
        hideHint();
      } else {
        showHint(trigger);
      }
      return;
    }
    hideHint();
  });
}

async function boot() {
  try {
    applyViewMode();
    initHints();
    const payload = await api("/api/overview");
    handleOverview(payload, false);
    await refreshAiStatus();
    connectStream();
  } catch (error) {
    els.mapStatusTitle.textContent = "Startup failed";
    els.mapStatusText.textContent = error.message;
  }
}

els.refreshBtn.addEventListener("click", () => {
  refresh().catch((error) => {
    els.mapStatusText.textContent = error.message;
  });
});

els.simulateBtn.addEventListener("click", async () => {
  try {
    await api("/api/simulate", { method: "POST" });
  } catch (error) {
    els.mapStatusText.textContent = error.message;
  }
});

els.modeBtn.addEventListener("click", async () => {
  try {
    await toggleMode();
  } catch (error) {
    els.mapStatusText.textContent = error.message;
  }
});

els.resetBtn.addEventListener("click", async () => {
  try {
    await resetDemo();
  } catch (error) {
    els.formStatus.textContent = error.message;
  }
});

els.recenterBtn.addEventListener("click", recenterMap);

els.aiIncidentBtn.addEventListener("click", () => {
  generateIncidentAi().catch((error) => {
    state.aiLoading = false;
    state.aiResult = null;
    state.aiStatus = state.aiStatus || {};
    state.aiStatus.error = error.message;
    renderAiCard();
  });
});

els.aiCityBtn.addEventListener("click", () => {
  generateCityAi().catch((error) => {
    state.aiLoading = false;
    state.aiResult = null;
    state.aiStatus = state.aiStatus || {};
    state.aiStatus.error = error.message;
    renderAiCard();
  });
});

els.detailCard.addEventListener("click", (event) => {
  handleDetailAction(event).catch((error) => {
    els.mapStatusText.textContent = error.message;
  });
});

els.incidentList.addEventListener("click", handleIncidentClick);
els.timelineList.addEventListener("click", handleTimelineClick);
els.scenarioPresetList.addEventListener("click", (event) => {
  const pending = handleScenarioPresetClick(event);
  if (!pending) {
    return;
  }
  pending.catch((error) => {
    els.mapStatusText.textContent = error.message;
  });
});

els.incidentForm.addEventListener("submit", (event) => {
  handleFormSubmit(event).catch((error) => {
    els.formStatus.textContent = error.message;
  });
});

for (const tab of els.modeTabs) {
  tab.addEventListener("click", () => {
    state.viewMode = tab.dataset.viewMode;
    applyViewMode();
    if (state.payload) {
      render(state.payload);
    }
  });
}

boot();
