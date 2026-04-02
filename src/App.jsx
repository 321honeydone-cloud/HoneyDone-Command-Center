import { useEffect, useMemo, useState } from "react";
import { appsScriptUrl, defaultState, quickLinks, serviceCatalog, serviceZones, storageKey } from "./data";
import logoImage from "./assets/logo-shirt-front.png";

const tabs = ["overview", "quotes", "prep", "closeout", "contacts"];
const apiKeyStorageKey = "honeydone-openai-api-key";
const estimatorModel = "gpt-4o-mini";
const maxEstimatorImages = 4;
const blankQuoteForm = {
  activeClient: "",
  clientName: "",
  address: "",
  city: "",
  service: "",
  urgency: "routine",
  scope: ""
};
const blankClientForm = {
  name: "",
  address: "",
  city: "",
  phone: "",
  email: ""
};
const estimatorSystemPrompt = `You are Handyman Field Estimator for HoneyDone. Think like a field technician and return a complete internal estimate with tools, materials, labor, risks, scope, pricing, and smart add-ons.

Rules:
- Labor rate is $100/hour
- Round labor up to the next full hour
- Minimum labor is 1 hour
- Trip fee is $100 and itemized
- Materials markup is 25%
- Contingency is 5% after subtotal
- Urgency markup: routine 0%, urgent 5%, emergency 20%
- Use premium done-right pricing
- Use nearest Brevard County Home Depot style pricing assumptions for materials

Guardrails:
- Never quote electrical beyond minor fixture, switch, or outlet swaps
- Do not include permit-required work as approved scope
- Flag unknowns instead of guessing
- Recommend onsite verification when scope is unclear
- Call out likely Brevard permit concerns when relevant

Return valid JSON only.`;
const estimateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "jobOverview",
    "preJobWalkthrough",
    "toolsNeeded",
    "materials",
    "stepByStepExecutionPlan",
    "laborBuildUp",
    "difficultyAdjustments",
    "riskFlags",
    "scopeOfWork",
    "pricingBuild",
    "smartAddOns",
    "finalRecommendedPrice",
    "permitNote",
    "assumptions"
  ],
  properties: {
    jobOverview: { type: "string" },
    preJobWalkthrough: { type: "array", items: { type: "string" } },
    toolsNeeded: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "reason"],
        properties: {
          item: { type: "string" },
          reason: { type: "string" }
        }
      }
    },
    materials: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "qty", "unit", "estimatedUnitCost", "estimatedLineTotal", "notes"],
        properties: {
          item: { type: "string" },
          qty: { type: "number" },
          unit: { type: "string" },
          estimatedUnitCost: { type: "number" },
          estimatedLineTotal: { type: "number" },
          notes: { type: "string" }
        }
      }
    },
    stepByStepExecutionPlan: { type: "array", items: { type: "string" } },
    laborBuildUp: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "hours"],
        properties: {
          task: { type: "string" },
          hours: { type: "number" }
        }
      }
    },
    difficultyAdjustments: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
    scopeOfWork: { type: "array", items: { type: "string" } },
    pricingBuild: {
      type: "object",
      additionalProperties: false,
      required: [
        "laborHours",
        "laborRate",
        "laborAmount",
        "tripFee",
        "materialsBase",
        "materialsMarkupPercent",
        "materialsMarkupAmount",
        "urgencyPercent",
        "urgencyAmount",
        "subtotal",
        "contingencyPercent",
        "contingencyAmount",
        "finalTotal"
      ],
      properties: {
        laborHours: { type: "number" },
        laborRate: { type: "number" },
        laborAmount: { type: "number" },
        tripFee: { type: "number" },
        materialsBase: { type: "number" },
        materialsMarkupPercent: { type: "number" },
        materialsMarkupAmount: { type: "number" },
        urgencyPercent: { type: "number" },
        urgencyAmount: { type: "number" },
        subtotal: { type: "number" },
        contingencyPercent: { type: "number" },
        contingencyAmount: { type: "number" },
        finalTotal: { type: "number" }
      }
    },
    smartAddOns: { type: "array", items: { type: "string" } },
    finalRecommendedPrice: { type: "number" },
    permitNote: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } }
  }
};

const loadState = () => {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : defaultState;
  } catch {
    return defaultState;
  }
};

const loadApiKey = () => {
  try {
    return window.localStorage.getItem(apiKeyStorageKey) || "";
  } catch {
    return "";
  }
};

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
}).format(Number(value || 0));

const today = () => new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric"
}).format(new Date());

function normalizeUrgency(value) {
  if (value === "standard") return "routine";
  if (value === "priority") return "urgent";
  return value || "routine";
}

function formatUrgencyLabel(value) {
  const normalized = normalizeUrgency(value);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function extractCity(address = "") {
  const parts = String(address).split(",");
  return parts.length > 1 ? parts[1].trim().split(" ")[0] : "";
}

function extractOutputText(payload) {
  if (payload.output_text) return payload.output_text;

  const textParts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join("\n");
}

function buildEstimatePrompt(values) {
  return [
    "Build a HoneyDone internal estimate and execution plan.",
    `Client: ${values.clientName || "Not provided"}`,
    `Property address: ${values.address || "Not provided"}`,
    `Client city: ${values.city}`,
    `Service category: ${values.service || "Not specified"}`,
    `Urgency: ${values.urgency}`,
    `Scope notes: ${values.scope}`,
    "",
    "Requirements:",
    "- Labor must use $100/hour and round up to the next full hour.",
    "- Trip fee must be $100.",
    "- Materials markup must be 25% and shown separately.",
    "- Contingency must be 5% and shown as a separate line after subtotal.",
    "- Use nearest Brevard County Home Depot style pricing for materials.",
    "- Recommend tools needed for the job.",
    "- Include a clean Jobber-ready scope of work.",
    "- Call out unknowns, risks, and permit concerns for Brevard County when relevant.",
    "- If scope is unclear, say onsite verification is recommended."
  ].join("\n");
}

function getQuotePrep(quote) {
  return quote.prep?.length
    ? quote.prep
    : (quote.estimate?.toolsNeeded || []).map((tool) => tool.item).slice(0, 6);
}

function getQuoteHours(quote) {
  return quote.hours || quote.estimate?.pricingBuild?.laborHours || 0;
}

function getQuoteTotal(quote) {
  return quote.total || quote.estimate?.pricingBuild?.finalTotal || quote.estimate?.finalRecommendedPrice || 0;
}

function getQuoteTripFee(quote) {
  return quote.tripFee || quote.estimate?.pricingBuild?.tripFee || 100;
}

function getQuoteChecklist(quote) {
  if (!quote?.estimate) return [];

  const toolItems = (quote.estimate.toolsNeeded || []).map((item) => `Tool: ${item.item}`);
  const materialItems = (quote.estimate.materials || []).map((item) => `Material: ${item.item}`);
  return [...toolItems, ...materialItems];
}

function buildMapsUrl(address, currentLocation) {
  const destination = encodeURIComponent(address || "");
  if (!destination) return "";

  if (currentLocation) {
    return `https://www.google.com/maps/dir/?api=1&origin=${currentLocation.lat},${currentLocation.lng}&destination=${destination}&travelmode=driving`;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
}

function buildMapEmbedUrl(address) {
  const destination = encodeURIComponent(address || "");
  if (!destination) return "";
  return `https://www.google.com/maps?q=${destination}&output=embed`;
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";

  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;

  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function formatMiles(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function serializePhoto(file) {
  if (!file) return null;

  const dataUrl = await readFileAsDataUrl(file);
  const [, payload = ""] = dataUrl.split(",");

  return {
    data: payload,
    mimeType: file.type || "image/jpeg",
    fileName: file.name
  };
}

function summarizeMedia(files) {
  return files.map((file) => ({
    name: file.name,
    type: file.type,
    size: file.size
  }));
}

async function parseJsonResponse(response, fallbackMessage) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(fallbackMessage);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(fallbackMessage);
  }
}

function dedupeClients(clients) {
  const seen = new Set();

  return clients.filter((client) => {
    const key = `${client.name || ""}|${client.address || ""}|${client.phone || ""}|${client.email || ""}`.toLowerCase();
    if (!key.trim() || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [appState, setAppState] = useState(loadState);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [checkStates, setCheckStates] = useState({});
  const [quoteForm, setQuoteForm] = useState(blankQuoteForm);
  const [quoteMedia, setQuoteMedia] = useState([]);
  const [openAiKey, setOpenAiKey] = useState(loadApiKey);
  const [estimateResult, setEstimateResult] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [showClientForm, setShowClientForm] = useState(false);
  const [newClientForm, setNewClientForm] = useState(blankClientForm);
  const [clientAddStatus, setClientAddStatus] = useState({ saving: false, error: "", success: "" });
  const [closeoutForm, setCloseoutForm] = useState({
    quoteId: "",
    invoiceTotal: 0,
    actualHours: 2,
    completionNote: ""
  });
  const [closeoutPhotos, setCloseoutPhotos] = useState({ before: null, after: null });
  const [closeoutStatus, setCloseoutStatus] = useState({ saving: false, error: "", success: "" });
  const [activeClients, setActiveClients] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientStatus, setClientStatus] = useState({ loading: true, error: "", source: "Loading...", fallback: "" });
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const [routeStatus, setRouteStatus] = useState({ loading: false, error: "", duration: "", distance: "" });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(appState));
  }, [appState]);

  useEffect(() => {
    window.localStorage.setItem(apiKeyStorageKey, openAiKey);
  }, [openAiKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadClients() {
      setClientStatus({ loading: true, error: "", source: "Apps Script", fallback: "" });

      try {
        const response = await fetch(`${appsScriptUrl}?action=get_all_clients`);
        const data = await parseJsonResponse(response, "Client feed returned an invalid or empty response.");

        if (!response.ok || data.success === false) {
          throw new Error(data.error || "Client list failed to load.");
        }

        const loadedClients = data.clients || [];

        if (!cancelled) {
          setActiveClients(loadedClients);
          setAllClients(loadedClients);
          setClientStatus({ loading: false, error: "", source: "Apps Script", fallback: "" });
        }
      } catch (error) {
        if (!cancelled) {
          setClientStatus({
            loading: false,
            error: error.message || "Client sync failed.",
            source: "Unavailable",
            fallback: ""
          });
        }
      }
    }

    loadClients();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!closeoutForm.quoteId && appState.quotes.length) {
      const latestQuote = appState.quotes[appState.quotes.length - 1];
      setCloseoutForm((current) => ({
        ...current,
        quoteId: latestQuote.id,
        invoiceTotal: Number(latestQuote.total || 0),
        actualHours: Number(latestQuote.hours || 0)
      }));
    }
  }, [appState.quotes, closeoutForm.quoteId]);

  useEffect(() => {
    if (!appState.quotes.length) {
      setSelectedQuoteId("");
      return;
    }

    if (!selectedQuoteId || !appState.quotes.some((quote) => quote.id === selectedQuoteId)) {
      setSelectedQuoteId(appState.quotes[appState.quotes.length - 1].id);
    }
  }, [appState.quotes, selectedQuoteId]);

  const activeQuote = appState.quotes[appState.quotes.length - 1] || null;
  const selectedSavedQuote = appState.quotes.find((quote) => quote.id === selectedQuoteId) || activeQuote;
  const selectedPrepQuote = selectedSavedQuote || activeQuote;
  const latestCloseout = appState.closeouts[appState.closeouts.length - 1] || null;
  const customClients = appState.customClients || [];
  const mergedClients = useMemo(() => dedupeClients([...allClients, ...customClients]), [allClients, customClients]);
  const openQuoteValue = appState.quotes.reduce((sum, quote) => sum + Number(getQuoteTotal(quote)), 0);
  const reachableClients = mergedClients.filter((client) => client.phone || client.email).length;
  const clientOptions = mergedClients;
  const prepChecklistItems = useMemo(() => getQuoteChecklist(selectedPrepQuote), [selectedPrepQuote]);
  const mapsUrl = buildMapsUrl(selectedPrepQuote?.address, currentLocation);
  const mapEmbedUrl = buildMapEmbedUrl(selectedPrepQuote?.address);
  const stats = [
    ["Open Quotes", appState.quotes.length],
    ["Quoted Value", money(openQuoteValue)],
    ["Quote Clients", clientOptions.length],
    ["Reachable Contacts", reachableClients]
  ];
  const filteredClients = useMemo(() => mergedClients.filter((client) => {
    const haystack = [client.name, client.city, client.phone, client.email, client.address].join(" ").toLowerCase();
    return haystack.includes(clientSearch.toLowerCase());
  }), [mergedClients, clientSearch]);
  const dataQualityMessage = mergedClients.length && !reachableClients
    ? "Client sync is live, but phone and email fields are empty in the current Apps Script response."
    : "";

  useEffect(() => {
    if (!prepChecklistItems.length) {
      setCheckStates({});
      return;
    }

    setCheckStates((current) => {
      const next = {};
      prepChecklistItems.forEach((item) => {
        next[item] = current[item] || false;
      });
      return next;
    });
  }, [prepChecklistItems]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoute() {
      if (!currentLocation || !selectedPrepQuote?.address) {
        if (!cancelled) {
          setRouteStatus({ loading: false, error: "", duration: "", distance: "" });
        }
        return;
      }

      setRouteStatus({ loading: true, error: "", duration: "", distance: "" });

      try {
        const geocodeResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(selectedPrepQuote.address)}`);
        const geocodeData = await geocodeResponse.json();
        const destination = geocodeData[0];

        if (!destination) {
          throw new Error("Could not find that job address on the map.");
        }

        const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${currentLocation.lng},${currentLocation.lat};${destination.lon},${destination.lat}?overview=false`);
        const routeData = await routeResponse.json();
        const route = routeData.routes && routeData.routes[0];

        if (!route) {
          throw new Error("Could not calculate drive time for that address.");
        }

        if (!cancelled) {
          setRouteStatus({
            loading: false,
            error: "",
            duration: formatDuration(route.duration / 60),
            distance: formatMiles(route.distance)
          });
        }
      } catch (error) {
        if (!cancelled) {
          setRouteStatus({
            loading: false,
            error: error.message || "Route unavailable right now.",
            duration: "",
            distance: ""
          });
        }
      }
    }

    loadRoute();

    return () => {
      cancelled = true;
    };
  }, [currentLocation, selectedPrepQuote?.address]);

  useEffect(() => {
    if (activeTab !== "prep" || !selectedPrepQuote?.address || currentLocation || locationRequested) {
      return;
    }

    useCurrentLocation();
  }, [activeTab, selectedPrepQuote?.address, currentLocation, locationRequested]);

  const onQuoteField = ({ target: { name, value } }) => {
    setEstimateResult(null);
    setEstimateError("");
    setQuoteForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "address" && !current.city ? { city: extractCity(value) } : {})
    }));
  };

  const onQuoteMediaField = ({ target: { files } }) => {
    if (!files || !files.length) return;

    setEstimateResult(null);
    setEstimateError("");
    setQuoteMedia((current) => [...current, ...Array.from(files)]);
  };

  const removeQuoteMedia = (index) => {
    setEstimateResult(null);
    setEstimateError("");
    setQuoteMedia((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const onClientPick = ({ target: { value } }) => {
    const selectedClient = clientOptions.find((client) => client.name === value);
    setEstimateResult(null);
    setEstimateError("");
    setClientAddStatus({ saving: false, error: "", success: "" });

    if (!selectedClient) {
      setQuoteForm((current) => ({ ...current, activeClient: "" }));
      return;
    }

    setQuoteForm((current) => ({
      ...current,
      activeClient: value,
      clientName: selectedClient.name || current.clientName,
      address: selectedClient.address || current.address,
      city: selectedClient.city || extractCity(selectedClient.address) || current.city
    }));
  };

  const onNewClientField = ({ target: { name, value } }) => {
    setClientAddStatus({ saving: false, error: "", success: "" });
    setNewClientForm((current) => ({ ...current, [name]: value }));
  };

  const onCloseoutField = ({ target: { name, value } }) => {
    setCloseoutForm((current) => ({ ...current, [name]: name === "invoiceTotal" || name === "actualHours" ? Number(value) : value }));
  };

  const onPhotoField = ({ target: { name, files } }) => {
    setCloseoutStatus({ saving: false, error: "", success: "" });
    setCloseoutPhotos((current) => ({
      ...current,
      [name]: files && files[0] ? files[0] : null
    }));
  };

  const useCurrentLocation = () => {
    setLocationRequested(true);

    if (!navigator.geolocation) {
      setRouteStatus({ loading: false, error: "Geolocation is not available in this browser.", duration: "", distance: "" });
      return;
    }

    setRouteStatus({ loading: true, error: "", duration: "", distance: "" });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCurrentLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      () => {
        setRouteStatus({ loading: false, error: "Current location was blocked or unavailable.", duration: "", distance: "" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const openQuoteForCloseout = (quote) => {
    if (!quote) return;

    setCloseoutForm({
      quoteId: quote.id,
      invoiceTotal: Number(getQuoteTotal(quote)),
      actualHours: Number(getQuoteHours(quote)),
      completionNote: ""
    });
    setCloseoutStatus({ saving: false, error: "", success: "" });
    setActiveTab("closeout");
  };

  const deleteQuote = (quoteId) => {
    setAppState((current) => ({
      ...current,
      quotes: current.quotes.filter((quote) => quote.id !== quoteId)
    }));
    if (selectedQuoteId === quoteId) {
      setSelectedQuoteId("");
    }
  };

  const saveClient = async () => {
    if (!newClientForm.name.trim()) {
      setClientAddStatus({ saving: false, error: "Client name is required.", success: "" });
      return;
    }

    const client = {
      name: newClientForm.name.trim(),
      address: newClientForm.address.trim(),
      city: newClientForm.city.trim() || extractCity(newClientForm.address),
      phone: newClientForm.phone.trim(),
      email: newClientForm.email.trim()
    };

    setClientAddStatus({ saving: true, error: "", success: "" });

    let successMessage = "Client added to this app.";

    try {
      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "save_client",
          client
        })
      });

      const payload = await parseJsonResponse(response, "").catch(() => ({}));

      if (response.ok && payload.success !== false) {
        successMessage = "Client added and sent to the client database.";
      } else {
        successMessage = "Client added here. CSV sync still needs a save_client action in Apps Script.";
      }
    } catch {
      successMessage = "Client added here. CSV sync still needs a save_client action in Apps Script.";
    }

    setAppState((current) => ({
      ...current,
      customClients: dedupeClients([...(current.customClients || []), client])
    }));
    setQuoteForm((current) => ({
      ...current,
      activeClient: client.name,
      clientName: client.name,
      address: client.address,
      city: client.city
    }));
    setShowClientForm(false);
    setNewClientForm(blankClientForm);
    setClientAddStatus({ saving: false, error: "", success: successMessage });
  };

  const generateEstimate = async () => {
    if (!openAiKey.trim()) {
      setEstimateError("Add your OpenAI API key first. It stays in this browser only for now.");
      return;
    }

    if (!quoteForm.scope.trim()) {
      setEstimateError("Scope notes are required for the estimator.");
      return;
    }

    if (!(quoteForm.city || extractCity(quoteForm.address))) {
      setEstimateError("City is required so the estimate can use Brevard-area pricing.");
      return;
    }

    setEstimateLoading(true);
    setEstimateError("");

    try {
      const imageFiles = quoteMedia.filter((file) => file.type.startsWith("image/")).slice(0, maxEstimatorImages);
      const imageInputs = await Promise.all(imageFiles.map(async (file) => ({
        type: "input_image",
        image_url: await readFileAsDataUrl(file)
      })));
      const videoCount = quoteMedia.filter((file) => file.type.startsWith("video/")).length;

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey.trim()}`
        },
        body: JSON.stringify({
          model: estimatorModel,
          input: [
            { role: "system", content: estimatorSystemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: buildEstimatePrompt({
                    ...quoteForm,
                    city: quoteForm.city || extractCity(quoteForm.address),
                    urgency: normalizeUrgency(quoteForm.urgency),
                    scope: `${quoteForm.scope}${videoCount ? `\n\nAttached reference videos: ${videoCount}. Videos are for planner reference and may need manual review.` : ""}`
                  })
                },
                ...imageInputs
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "handyman_estimate",
              strict: true,
              schema: estimateSchema
            }
          }
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error?.message || "Estimator request failed.");
      }

      const outputText = extractOutputText(payload);
      if (!outputText) {
        throw new Error("Estimator returned no structured output.");
      }

      setEstimateResult(JSON.parse(outputText));
    } catch (error) {
      setEstimateResult(null);
      setEstimateError(error.message || "Estimator failed.");
    } finally {
      setEstimateLoading(false);
    }
  };

  const saveQuote = async () => {
    if (!estimateResult) {
      setEstimateError("Generate an estimate before saving the quote.");
      return;
    }

    const pricing = estimateResult.pricingBuild;
    const savedQuote = {
      id: `HD-${String(Date.now()).slice(-5)}`,
      clientName: quoteForm.clientName || "Client pending",
      address: quoteForm.address,
      city: quoteForm.city || extractCity(quoteForm.address),
      service: quoteForm.service || "General Repairs",
      urgency: normalizeUrgency(quoteForm.urgency),
      scope: quoteForm.scope,
      estimate: estimateResult,
      total: pricing.finalTotal,
      labor: pricing.laborAmount,
      tripFee: pricing.tripFee,
      hours: pricing.laborHours,
      materials: pricing.materialsBase,
      contingency: pricing.contingencyAmount,
      prep: estimateResult.toolsNeeded.map((tool) => tool.item).slice(0, 6),
      media: summarizeMedia(quoteMedia),
      status: normalizeUrgency(quoteForm.urgency) === "emergency" ? "Emergency Quote Ready" : "Estimate Ready to Send"
    };

    try {
      await fetch(appsScriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "save_quote",
          quoteId: savedQuote.id,
          client: savedQuote.clientName,
          city: savedQuote.city,
          quote: {
            jobTitle: savedQuote.service,
            category: savedQuote.service,
            estimatedHours: savedQuote.hours,
            tripCount: 1,
            grandTotal: savedQuote.total,
            total: savedQuote.total,
            scopeOfWork: savedQuote.estimate?.scopeOfWork || [savedQuote.scope],
            materials: savedQuote.estimate?.materials || []
          }
        })
      });
    } catch {
      // Keep the UI moving even if the sheet save hiccups.
    }

    setAppState((current) => ({ ...current, quotes: [...current.quotes, savedQuote] }));
    setSelectedQuoteId(savedQuote.id);
    setQuoteForm(blankQuoteForm);
    setQuoteMedia([]);
    setEstimateResult(null);
    setEstimateError("");
    setCheckStates({});
    setActiveTab("prep");
  };

  const saveCloseout = async (event) => {
    event.preventDefault();
    const quote = appState.quotes.find((item) => item.id === closeoutForm.quoteId);
    if (!quote) return;

    setCloseoutStatus({ saving: true, error: "", success: "" });

    try {
      const beforePhoto = await serializePhoto(closeoutPhotos.before);
      const afterPhoto = await serializePhoto(closeoutPhotos.after);

      const response = await fetch(appsScriptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "save_completion",
          quoteId: quote.id,
          clientName: quote.clientName,
          timeCompleted: new Date().toLocaleString(),
          actualHours: Number(closeoutForm.actualHours || getQuoteHours(quote)),
          completionNotes: closeoutForm.completionNote || "Completed scope, verified operation, and cleaned up work area.",
          invoiceAmount: Number(closeoutForm.invoiceTotal || getQuoteTotal(quote)),
          beforePhoto,
          afterPhoto
        })
      });

      const result = await parseJsonResponse(response, "").catch(() => ({}));
      if (!response.ok || result.success === false) {
        throw new Error(result.error || "Closeout sync failed.");
      }
    } catch (error) {
      const closeout = {
        quoteId: quote.id,
        clientName: quote.clientName,
        service: quote.service,
        invoiceTotal: Number(closeoutForm.invoiceTotal || getQuoteTotal(quote)),
        actualHours: Number(closeoutForm.actualHours || getQuoteHours(quote)),
        completionNote: closeoutForm.completionNote || "Completed scope, verified operation, and cleaned up work area."
      };
      setAppState((current) => ({
        quotes: current.quotes.filter((item) => item.id !== quote.id),
        closeouts: [...current.closeouts, closeout]
      }));
      setCloseoutForm({ quoteId: "", invoiceTotal: 0, actualHours: 2, completionNote: "" });
      setCloseoutPhotos({ before: null, after: null });
      setCloseoutStatus({
        saving: false,
        error: "",
        success: `Closeout saved locally. Remote sync is unavailable right now: ${error.message || "Closeout sync failed."}`
      });
      return;
    }

    const closeout = {
      quoteId: quote.id,
      clientName: quote.clientName,
      service: quote.service,
      invoiceTotal: Number(closeoutForm.invoiceTotal || getQuoteTotal(quote)),
      actualHours: Number(closeoutForm.actualHours || getQuoteHours(quote)),
      completionNote: closeoutForm.completionNote || "Completed scope, verified operation, and cleaned up work area."
    };
    setAppState((current) => ({
      quotes: current.quotes.filter((item) => item.id !== quote.id),
      closeouts: [...current.closeouts, closeout]
    }));
    setCloseoutForm({ quoteId: "", invoiceTotal: 0, actualHours: 2, completionNote: "" });
    setCloseoutPhotos({ before: null, after: null });
    setCloseoutStatus({ saving: false, error: "", success: "Closeout saved and photos sent to Drive." });
  };

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <img className="brand-logo" src={logoImage} alt="HoneyDone logo" />
          <div>
            <p className="eyebrow">HoneyDone Handyman</p>
            <h1 className="topbar-title">Command Center</h1>
          </div>
        </div>
        <nav className="topbar-nav" aria-label="Primary">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={`topbar-link ${activeTab === tab ? "is-active" : ""}`}
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {tab === "prep" ? "Mission Prep" : tab === "closeout" ? "Closeout" : tab === "contacts" ? "Quick Dial" : tab === "quotes" ? "Quote Builder" : "Overview"}
            </button>
          ))}
        </nav>
      </header>

      <main className="workspace website-layout">
        <section className="trustbar">
          <span>Veteran-Owned</span>
          <span>Insured</span>
          <span>Firm Pricing</span>
          <span>Fast Response</span>
          <span>Brevard County</span>
          <span>{today()}</span>
        </section>

        {activeTab === "overview" && <section className="panel is-active">
          <div className="stats-grid">{stats.map(([label, value]) => <article className="stat-card" key={label}><span>{label}</span><strong className="stat-value">{value}</strong></article>)}</div>
          <div className="two-column">
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Service Zones</p><h3>Brevard County focus</h3></div><span className="pill">Core territory</span></div>
              <div className="service-zones">{serviceZones.map((zone) => <div className="zone-chip" key={zone}>{zone}</div>)}</div>
            </article>
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Pipeline</p><h3>What needs attention next</h3></div></div>
              <div className="pipeline-list">
                {appState.quotes.length ? appState.quotes.slice().reverse().slice(0, 4).map((quote) => <div className="pipeline-item" key={quote.id}><span>{quote.id}</span><strong>{quote.clientName}</strong><p>{quote.service} in {quote.address || quote.city || "Brevard County"}.</p><span>{quote.status}</span></div>) : <div className="empty-state">No quotes yet. Build one in the Quote Builder tab.</div>}
              </div>
            </article>
          </div>
        </section>}

        {activeTab === "quotes" && <section className="panel is-active">
          <div className="two-column quote-builder-grid">
            <article className="card quote-editor-card">
              <div className="card-header"><div><p className="section-kicker">Estimator</p><h3>Build an AI field-ready quote</h3></div></div>
              <div className="form-stack">
                <label><span>Client list</span><select name="activeClient" value={quoteForm.activeClient} onChange={onClientPick}><option value="">Select client...</option>{clientOptions.map((client) => <option key={`${client.name}-${client.address}`} value={client.name}>{client.name}{client.city ? ` - ${client.city}` : ""}</option>)}</select></label>
                <p className="field-note">Client source: {clientStatus.source}{clientStatus.fallback ? ` - ${clientStatus.fallback}` : ""}</p>
                <div className="client-inline-actions">
                  <button className="mini-action mini-action-button" type="button" onClick={() => setShowClientForm((current) => !current)}>{showClientForm ? "Cancel New Client" : "Add New Client"}</button>
                </div>
                {showClientForm ? <div className="mini-panel client-create-panel">
                  <span>New Client</span>
                  <div className="form-stack">
                    <label><span>Client name</span><input name="name" value={newClientForm.name} onChange={onNewClientField} placeholder="First Last" /></label>
                    <label><span>Property address</span><input name="address" value={newClientForm.address} onChange={onNewClientField} placeholder="Address" /></label>
                    <div className="form-split">
                      <label><span>City</span><input name="city" value={newClientForm.city} onChange={onNewClientField} placeholder="City" /></label>
                      <label><span>Phone</span><input name="phone" value={newClientForm.phone} onChange={onNewClientField} placeholder="3215551234" /></label>
                    </div>
                    <label><span>Email</span><input name="email" value={newClientForm.email} onChange={onNewClientField} placeholder="customer@email.com" /></label>
                    {clientAddStatus.error ? <div className="status-note is-error">{clientAddStatus.error}</div> : null}
                    <button className="secondary-button" type="button" onClick={saveClient} disabled={clientAddStatus.saving}>{clientAddStatus.saving ? "Saving Client..." : "Save Client"}</button>
                  </div>
                </div> : null}
                {clientAddStatus.success ? <p className="field-note">{clientAddStatus.success}</p> : null}
                <label><span>Customer name</span><input name="clientName" value={quoteForm.clientName} onChange={onQuoteField} placeholder="First Last" required /></label>
                <label><span>Property address</span><input name="address" value={quoteForm.address} onChange={onQuoteField} placeholder="Address" /></label>
                <div className="form-split">
                  <label><span>Client city</span><input name="city" value={quoteForm.city} onChange={onQuoteField} placeholder="City" required /></label>
                  <label><span>Urgency</span><select name="urgency" value={quoteForm.urgency} onChange={onQuoteField}><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></label>
                </div>
                <label><span>Service category</span><select name="service" value={quoteForm.service} onChange={onQuoteField}><option value="">Not specified</option>{serviceCatalog.map((service) => <option key={service.name} value={service.name}>{service.name}</option>)}</select></label>
                <label><span>Scope notes</span><textarea name="scope" rows="6" value={quoteForm.scope} onChange={onQuoteField} placeholder="Explain the full job, access issues, damage, customer expectations, and anything that feels uncertain." required /></label>
                <div className="media-stack">
                  <label><span>Upload photo or video</span><input type="file" accept="image/*,video/*" capture="environment" multiple onChange={onQuoteMediaField} /></label>
                  <p className="field-note">Images are included in AI estimate analysis. Videos stay attached to the quote for field reference, so keep them around one minute when possible.</p>
                  {quoteMedia.length ? <div className="media-list">{quoteMedia.map((file, index) => <div className="media-item" key={`${file.name}-${index}`}><div className="media-item-copy"><strong title={file.name}>{file.name}</strong><p>{file.type.startsWith("video/") ? "Video reference" : "Image reference"} - {(file.size / 1024 / 1024).toFixed(1)} MB</p></div><button className="mini-action mini-action-button" type="button" onClick={() => removeQuoteMedia(index)}>Remove</button></div>)}</div> : null}
                </div>
                {estimateError ? <div className="status-note is-error">{estimateError}</div> : null}
                <div className="form-actions">
                  <button className="primary-button" type="button" onClick={generateEstimate} disabled={estimateLoading}>{estimateLoading ? "Generating..." : "Generate Estimate"}</button>
                  <button className="secondary-button" type="button" onClick={saveQuote} disabled={!estimateResult || estimateLoading}>Save Quote</button>
                </div>
              </div>
            </article>
            <article className="card accent-card estimate-preview-card">
              <div className="card-header"><div><p className="section-kicker">Estimate Preview</p><h3>AI quote summary</h3></div></div>
              <div className="estimate-scroll">
              {!estimateResult ? <div className="quote-preview">
                <span>Waiting on estimate</span>
                <strong>{quoteForm.clientName || "Client pending"}</strong>
                <p>Generate an estimate to see labor build-up, materials, tools needed, risks, and the customer-facing total.</p>
                <div className="mini-panel"><span>Estimator Rules</span><p>$100/hour labor, $100 trip fee, 25% materials markup, 5% contingency after subtotal, and urgency markup only when needed.</p></div>
              </div> : <div className="quote-preview estimate-report">
                <span>Estimate ready</span>
                <strong>{quoteForm.clientName || "Client pending"}</strong>
                <p>{estimateResult.jobOverview}</p>
                <div className="preview-total">{money(estimateResult.pricingBuild.finalTotal)}</div>
                <div className="quote-breakdown">
                  <div><span>Labor</span><strong>{money(estimateResult.pricingBuild.laborAmount)}</strong></div>
                  <div><span>Trip Fee</span><strong>{money(estimateResult.pricingBuild.tripFee)}</strong></div>
                  <div><span>Materials Base</span><strong>{money(estimateResult.pricingBuild.materialsBase)}</strong></div>
                  <div><span>Materials Markup</span><strong>{money(estimateResult.pricingBuild.materialsMarkupAmount)}</strong></div>
                  <div><span>Urgency</span><strong>{money(estimateResult.pricingBuild.urgencyAmount)}</strong></div>
                  <div><span>Subtotal</span><strong>{money(estimateResult.pricingBuild.subtotal)}</strong></div>
                  <div><span>Contingency</span><strong>{money(estimateResult.pricingBuild.contingencyAmount)}</strong></div>
                  <div><span>Final Total</span><strong>{money(estimateResult.finalRecommendedPrice)}</strong></div>
                </div>
                <div className="estimate-section"><h4>Scope of Work</h4><ul className="estimate-list">{estimateResult.scopeOfWork.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div className="estimate-section"><h4>Labor Estimate</h4><div className="estimate-grid"><div><span>Estimated Hours</span><strong>{estimateResult.pricingBuild.laborHours}</strong></div><div><span>Labor Rate</span><strong>{money(estimateResult.pricingBuild.laborRate)}</strong></div></div><ul className="estimate-list">{estimateResult.laborBuildUp.map((item) => <li key={item.task}>{item.task}: {item.hours} hr</li>)}</ul></div>
                <div className="estimate-section"><h4>Materials</h4><div className="estimate-materials">{estimateResult.materials.map((item) => <div className="material-row" key={`${item.item}-${item.unit}`}><div><strong>{item.item}</strong><p>{item.qty} {item.unit} · {item.notes}</p></div><strong>{money(item.estimatedLineTotal)}</strong></div>)}</div></div>
                <div className="estimate-section"><h4>Tools Needed</h4><ul className="estimate-list">{estimateResult.toolsNeeded.map((item) => <li key={item.item}>{item.item}: {item.reason}</li>)}</ul></div>
                <div className="estimate-section"><h4>Risks / Unknowns</h4><ul className="estimate-list">{estimateResult.riskFlags.map((item) => <li key={item}>{item}</li>)}</ul>{estimateResult.assumptions.length ? <div className="mini-panel"><span>Assumptions</span><p>{estimateResult.assumptions.join(" ")}</p></div> : null}</div>
                <div className="estimate-section"><h4>Permit Note</h4><p>{estimateResult.permitNote}</p></div>
              </div>}
              </div>
            </article>
          </div>
          <article className="card">
            <div className="card-header"><div><p className="section-kicker">Saved Quotes</p><h3>Recent field-ready estimates</h3></div></div>
            <div className="saved-list">{appState.quotes.length ? appState.quotes.slice().reverse().map((quote) => <button className={`saved-item saved-item-button ${selectedSavedQuote?.id === quote.id ? "is-selected" : ""}`} type="button" key={quote.id} onClick={() => setSelectedQuoteId(quote.id)}><span>{quote.id}</span><strong>{quote.clientName} - {quote.service}</strong><p>{quote.address || "Address not set"}</p><p>{money(getQuoteTotal(quote))} - {quote.status}</p></button>) : <div className="empty-state">No saved quotes yet.</div>}</div>
          </article>
          <article className="card accent-card">
            <div className="card-header"><div><p className="section-kicker">Selected Quote</p><h3>Open saved estimate</h3></div>{selectedSavedQuote ? <div className="quote-actions"><button className="icon-action" type="button" onClick={() => openQuoteForCloseout(selectedSavedQuote)} aria-label="Mark quote complete"><span aria-hidden="true">✓</span></button><button className="icon-action is-danger" type="button" onClick={() => deleteQuote(selectedSavedQuote.id)} aria-label="Delete quote"><span aria-hidden="true">X</span></button></div> : null}</div>
            {selectedSavedQuote ? <div className="quote-preview estimate-report">
              <span>{selectedSavedQuote.id}</span>
              <strong>{selectedSavedQuote.clientName}</strong>
              <p>{selectedSavedQuote.scope || selectedSavedQuote.estimate?.jobOverview || "No scope saved."}</p>
              <div className="preview-total">{money(getQuoteTotal(selectedSavedQuote))}</div>
              <div className="quote-breakdown">
                <div><span>Labor</span><strong>{money(selectedSavedQuote.labor || selectedSavedQuote.estimate?.pricingBuild?.laborAmount)}</strong></div>
                <div><span>Trip Fee</span><strong>{money(getQuoteTripFee(selectedSavedQuote))}</strong></div>
                <div><span>Materials Base</span><strong>{money(selectedSavedQuote.materials || selectedSavedQuote.estimate?.pricingBuild?.materialsBase)}</strong></div>
                <div><span>Contingency</span><strong>{money(selectedSavedQuote.contingency || selectedSavedQuote.estimate?.pricingBuild?.contingencyAmount)}</strong></div>
              </div>
              {selectedSavedQuote.estimate?.scopeOfWork?.length ? <div className="estimate-section"><h4>Scope of Work</h4><ul className="estimate-list">{selectedSavedQuote.estimate.scopeOfWork.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
              {selectedSavedQuote.media?.length ? <div className="estimate-section"><h4>Attached Media</h4><ul className="estimate-list">{selectedSavedQuote.media.map((item) => <li key={`${item.name}-${item.size}`}>{item.name} - {item.type.startsWith("video/") ? "Video" : "Image"}</li>)}</ul></div> : null}
              {selectedSavedQuote.estimate?.toolsNeeded?.length ? <div className="estimate-section"><h4>Tools Needed</h4><ul className="estimate-list">{selectedSavedQuote.estimate.toolsNeeded.map((item) => <li key={item.item}>{item.item}: {item.reason}</li>)}</ul></div> : <div className="mini-panel"><span>Loadout</span><p>{getQuotePrep(selectedSavedQuote).join(", ") || "No loadout saved yet."}</p></div>}
              {selectedSavedQuote.estimate?.permitNote ? <div className="estimate-section"><h4>Permit Note</h4><p>{selectedSavedQuote.estimate.permitNote}</p></div> : null}
            </div> : <div className="empty-state">Click a saved quote to display it here.</div>}
          </article>
        </section>}

        {activeTab === "prep" && <section className="panel is-active">
          <div className="two-column">
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Mission Brief</p><h3>Load the truck with intent</h3></div></div>
              {selectedPrepQuote ? <div className="prep-summary"><span>{selectedPrepQuote.id}</span><strong>{selectedPrepQuote.clientName}</strong><p>{selectedPrepQuote.service} at {selectedPrepQuote.address || selectedPrepQuote.city || "Brevard County property"}.</p><div className="prep-grid"><div><span>Trip Fee</span><strong>{money(getQuoteTripFee(selectedPrepQuote))}</strong></div><div><span>Estimated Hours</span><strong>{getQuoteHours(selectedPrepQuote)}</strong></div><div><span>Urgency</span><strong>{formatUrgencyLabel(selectedPrepQuote.urgency)}</strong></div></div><div className="mini-panel"><span>Truck Loadout</span><p>{getQuotePrep(selectedPrepQuote).join(", ") || "Generate an estimate to build the loadout."}</p></div><div className="mini-panel"><span>Drive Route</span><p>{selectedPrepQuote.address || "Quote address missing."}</p>{mapEmbedUrl ? <div className="map-frame-wrap"><iframe className="map-frame" title="Job location map" src={mapEmbedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div> : null}<div className="route-meta"><div><span>Origin</span><strong>{currentLocation ? "Current location shared" : "Waiting on browser permission"}</strong></div><div><span>ETA</span><strong>{routeStatus.loading ? "Checking..." : routeStatus.duration || "Allow location access"}</strong></div><div><span>Distance</span><strong>{routeStatus.distance || "-"}</strong></div></div>{routeStatus.error ? <p>{routeStatus.error}</p> : <p>Browser location permission is used to calculate drive time from where you are now.</p>}<div className="client-actions">{selectedPrepQuote.address ? <a className="mini-action" href={mapsUrl || buildMapsUrl(selectedPrepQuote.address)} target="_blank" rel="noreferrer">Google Maps</a> : null}<button className="mini-action mini-action-button" type="button" onClick={useCurrentLocation}>Retry Location</button></div></div>{selectedPrepQuote.estimate?.smartAddOns?.length ? <div className="mini-panel"><span>Smart Add-Ons</span><p>{selectedPrepQuote.estimate.smartAddOns.join(" | ")}</p></div> : null}</div> : <div className="empty-state">Save a quote first to generate the mission brief.</div>}
            </article>
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Departure Checklist</p><h3>Tools and materials to load</h3></div></div>
              <div className="checklist">{prepChecklistItems.length ? prepChecklistItems.map((item) => <label className={`check-item ${checkStates[item] ? "is-done" : ""}`} key={item}><input type="checkbox" checked={Boolean(checkStates[item])} onChange={() => setCheckStates((current) => ({ ...current, [item]: !current[item] }))} /><span>{item}</span></label>) : <div className="empty-state">Generate or select a quote to build the loadout checklist.</div>}</div>
            </article>
          </div>
        </section>}

        {activeTab === "closeout" && <section className="panel is-active">
          <div className="two-column">
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Job Closeout</p><h3>Document the finished work</h3></div></div>
              <form className="form-stack" onSubmit={saveCloseout}>
                <label><span>Completed job</span><select name="quoteId" value={closeoutForm.quoteId} onChange={onCloseoutField} disabled={!appState.quotes.length}>{appState.quotes.length ? appState.quotes.slice().reverse().map((quote) => <option key={quote.id} value={quote.id}>{quote.id} - {quote.clientName} - {quote.service}</option>) : <option value="">No quotes available yet</option>}</select></label>
                <div className="form-split">
                  <label><span>Invoice total</span><input name="invoiceTotal" type="number" min="0" step="1" value={closeoutForm.invoiceTotal} onChange={onCloseoutField} /></label>
                  <label><span>Actual hours</span><input name="actualHours" type="number" min="0" step="0.5" value={closeoutForm.actualHours} onChange={onCloseoutField} /></label>
                </div>
                <label><span>Completion note</span><textarea name="completionNote" rows="5" value={closeoutForm.completionNote} onChange={onCloseoutField} placeholder="Completed repair, tested operation, cleaned work area, and reviewed result with customer." /></label>
                <div className="form-split">
                  <label><span>Before photo</span><input name="before" type="file" accept="image/*" onChange={onPhotoField} /></label>
                  <label><span>After photo</span><input name="after" type="file" accept="image/*" onChange={onPhotoField} /></label>
                </div>
                {closeoutStatus.error ? <div className="status-note is-error">{closeoutStatus.error}</div> : null}
                {closeoutStatus.success ? <div className="field-note">{closeoutStatus.success}</div> : null}
                <p className="field-note">Photos are sent to Apps Script during closeout. To save them under `My Drive/1. Clients/Client Name/Job Photos`, the Apps Script upload handler needs that folder-path update.</p>
                <button className="primary-button" type="submit" disabled={!appState.quotes.length || closeoutStatus.saving}>{closeoutStatus.saving ? "Saving..." : "Save Closeout"}</button>
              </form>
            </article>
            <article className="card accent-card">
              <div className="card-header"><div><p className="section-kicker">Customer Follow-Up</p><h3>Message preview</h3></div></div>
              {latestCloseout ? <div className="follow-up-preview"><span>{latestCloseout.quoteId}</span><strong>Follow-up draft</strong><p>Thanks again for choosing HoneyDone. Your {latestCloseout.service.toLowerCase()} work has been completed, the area was cleaned up, and everything was checked before wrap-up. If anything settles or you want us to handle the next item on your list, just reply here and we will take care of it.</p><div className="mini-panel"><span>Invoice</span><p>{money(latestCloseout.invoiceTotal)} - {latestCloseout.actualHours} hours on site</p></div></div> : <div className="empty-state">Save a closeout to generate a polished follow-up message for the customer.</div>}
            </article>
          </div>
          <article className="card">
            <div className="card-header"><div><p className="section-kicker">Completed Jobs</p><h3>Recent closeouts</h3></div></div>
            <div className="saved-list">{appState.closeouts.length ? appState.closeouts.slice().reverse().map((closeout) => <article className="saved-item" key={`${closeout.quoteId}-${closeout.invoiceTotal}`}><span>{closeout.quoteId}</span><strong>{closeout.clientName}</strong><p>{closeout.completionNote}</p><p>{money(closeout.invoiceTotal)} - {closeout.actualHours} hours</p></article>) : <div className="empty-state">No jobs have been closed out yet.</div>}</div>
          </article>
        </section>}

        {activeTab === "contacts" && <section className="panel is-active">
          <div className="two-column">
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Client Directory</p><h3>Call or email from the full list</h3></div></div>
              <div className="form-stack">
                <label><span>Search clients</span><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Search by name, city, phone, or email" /></label>
              </div>
              {clientStatus.loading ? <div className="empty-state">Loading client lists...</div> : null}
              {clientStatus.error ? <div className="empty-state">{clientStatus.error}</div> : null}
              {!clientStatus.loading && !clientStatus.error ? <div className="client-directory">
                {filteredClients.length ? filteredClients.map((client) => <article className="client-row" key={`${client.name}-${client.address}`}>
                  <div className="client-main">
                    <span>{client.city || "Brevard County"}</span>
                    <strong>{client.name}</strong>
                    <p>{client.address || "No address in feed yet."}</p>
                    <p>{client.phone || "No phone returned"}{client.email ? ` - ${client.email}` : client.phone ? "" : " - No email returned"}</p>
                  </div>
                  <div className="client-actions">
                    {client.phone ? <a className="mini-action" href={`tel:${client.phone}`}>Call</a> : <span className="mini-action is-disabled">No Phone</span>}
                    {client.email ? <a className="mini-action" href={`mailto:${client.email}`}>Email</a> : <span className="mini-action is-disabled">No Email</span>}
                  </div>
                </article>) : <div className="empty-state">No clients match that search.</div>}
              </div> : null}
            </article>
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Sync Status</p><h3>Client feeds and company shortcuts</h3></div></div>
              <div className="brand-guidelines">
                <p>Client source: {clientStatus.source}</p>
                <p>Loaded records: {mergedClients.length}</p>
                {clientStatus.fallback ? <p>{clientStatus.fallback}</p> : null}
                {dataQualityMessage ? <p>{dataQualityMessage}</p> : <p>Phone and email data are available for {reachableClients} client records.</p>}
              </div>
              <div className="mini-panel">
                <span>Estimator Setup</span>
                <div className="form-stack">
                  <label><span>OpenAI API key</span><input name="apiKey" type="password" value={openAiKey} onChange={(event) => setOpenAiKey(event.target.value)} placeholder="sk-..." /></label>
                  <p className="field-note">Set this once here instead of inside the quote builder. It stays in this browser only for now.</p>
                </div>
              </div>
              <div className="quick-links">{quickLinks.map((item) => <a className="quick-link" href={item.href} key={item.label} target={item.href.startsWith("http") ? "_blank" : undefined} rel={item.href.startsWith("http") ? "noreferrer" : undefined}><div><span>{item.meta}</span><strong>{item.label}</strong></div><em>Open</em></a>)}</div>
            </article>
          </div>
        </section>}
      </main>
    </div>
  );
}
