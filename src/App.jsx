import { useEffect, useMemo, useState } from "react";
import { appsScriptUrl, defaultState, quickLinks, serviceCatalog, serviceZones, storageKey } from "./data";
import logoImage from "./assets/logo-shirt-front.png";

const tabs = ["overview", "quotes", "prep", "closeout", "contacts"];
const checklistItems = [
  "Confirm customer arrival window",
  "Load specialty tools",
  "Pack surface protection",
  "Verify materials on hand",
  "Review scope and upsell opportunities"
];

const loadState = () => {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : defaultState;
  } catch {
    return defaultState;
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

function getService(name) {
  return serviceCatalog.find((service) => service.name === name) || serviceCatalog[0];
}

function buildQuote(values) {
  const service = getService(values.service);
  const urgencyMultiplier = values.urgency === "emergency" ? 1.42 : values.urgency === "priority" ? 1.18 : 1;
  const labor = Math.round(service.base * Number(values.hours) * urgencyMultiplier);
  const tripFee = values.urgency === "emergency" ? 180 : values.urgency === "priority" ? service.trip + 15 : service.trip;
  const contingency = Math.round(Number(values.materials) * 0.1);
  return { labor, tripFee, contingency, total: labor + tripFee + Number(values.materials) + contingency, prep: service.prep };
}

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [appState, setAppState] = useState(loadState);
  const [checks, setChecks] = useState(checklistItems.map(() => false));
  const [quoteForm, setQuoteForm] = useState({
    clientName: "",
    address: "",
    service: serviceCatalog[0].name,
    urgency: "standard",
    hours: 2,
    materials: 85,
    scope: ""
  });
  const [closeoutForm, setCloseoutForm] = useState({
    quoteId: "",
    invoiceTotal: 0,
    actualHours: 2,
    completionNote: ""
  });
  const [activeClients, setActiveClients] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientStatus, setClientStatus] = useState({ loading: true, error: "" });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(appState));
  }, [appState]);

  useEffect(() => {
    let cancelled = false;

    async function loadClients() {
      setClientStatus({ loading: true, error: "" });

      try {
        const [activeResponse, allResponse] = await Promise.all([
          fetch(`${appsScriptUrl}?action=get_active_clients`),
          fetch(`${appsScriptUrl}?action=get_all_clients`)
        ]);

        const [activeData, allData] = await Promise.all([
          activeResponse.json(),
          allResponse.json()
        ]);

        if (!activeResponse.ok || activeData.success === false) {
          throw new Error(activeData.error || "Active clients failed to load.");
        }

        if (!allResponse.ok || allData.success === false) {
          throw new Error(allData.error || "Full client list failed to load.");
        }

        if (!cancelled) {
          setActiveClients(activeData.clients || []);
          setAllClients(allData.clients || []);
          setClientStatus({ loading: false, error: "" });
        }
      } catch (error) {
        if (!cancelled) {
          setClientStatus({ loading: false, error: error.message || "Client sync failed." });
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
      setCloseoutForm((current) => ({ ...current, quoteId: appState.quotes[appState.quotes.length - 1].id }));
    }
  }, [appState.quotes, closeoutForm.quoteId]);

  const quotePreview = useMemo(() => buildQuote(quoteForm), [quoteForm]);
  const activeQuote = appState.quotes[appState.quotes.length - 1] || null;
  const latestCloseout = appState.closeouts[appState.closeouts.length - 1] || null;
  const openQuoteValue = appState.quotes.reduce((sum, quote) => sum + Number(quote.total || 0), 0);
  const averageQuote = appState.quotes.length ? Math.round(openQuoteValue / appState.quotes.length) : 0;
  const reachableClients = allClients.filter((client) => client.phone || client.email).length;
  const stats = [
    ["Open Quotes", appState.quotes.length],
    ["Quoted Value", money(openQuoteValue)],
    ["Active Clients", activeClients.length],
    ["Reachable Contacts", reachableClients]
  ];
  const filteredClients = allClients.filter((client) => {
    const haystack = [client.name, client.city, client.phone, client.email, client.address].join(" ").toLowerCase();
    return haystack.includes(clientSearch.toLowerCase());
  });
  const dataQualityMessage = allClients.length && !reachableClients
    ? "Client sync is live, but phone and email fields are empty in the current Apps Script response."
    : "";

  const onQuoteField = ({ target: { name, value } }) => {
    setQuoteForm((current) => ({ ...current, [name]: name === "hours" || name === "materials" ? Number(value) : value }));
  };

  const onClientPick = ({ target: { value } }) => {
    const selectedClient = activeClients.find((client) => client.name === value);
    if (!selectedClient) return;

    setQuoteForm((current) => ({
      ...current,
      clientName: selectedClient.name || current.clientName,
      address: selectedClient.address || current.address
    }));
  };

  const onCloseoutField = ({ target: { name, value } }) => {
    setCloseoutForm((current) => ({ ...current, [name]: name === "invoiceTotal" || name === "actualHours" ? Number(value) : value }));
  };

  const saveQuote = (event) => {
    event.preventDefault();
    const pricing = buildQuote(quoteForm);
    const savedQuote = {
      id: `HD-${String(Date.now()).slice(-5)}`,
      ...quoteForm,
      ...pricing,
      status: quoteForm.urgency === "emergency" ? "Priority Dispatch" : "Ready to Send"
    };
    setAppState((current) => ({ ...current, quotes: [...current.quotes, savedQuote] }));
    setQuoteForm({ clientName: "", address: "", service: serviceCatalog[0].name, urgency: "standard", hours: 2, materials: 85, scope: "" });
    setChecks(checklistItems.map(() => false));
    setActiveTab("quotes");
  };

  const saveCloseout = (event) => {
    event.preventDefault();
    const quote = appState.quotes.find((item) => item.id === closeoutForm.quoteId);
    if (!quote) return;
    const closeout = {
      quoteId: quote.id,
      clientName: quote.clientName,
      service: quote.service,
      invoiceTotal: Number(closeoutForm.invoiceTotal || quote.total),
      actualHours: Number(closeoutForm.actualHours || quote.hours),
      completionNote: closeoutForm.completionNote || "Completed scope, verified operation, and cleaned up work area."
    };
    setAppState((current) => ({
      quotes: current.quotes.filter((item) => item.id !== quote.id),
      closeouts: [...current.closeouts, closeout]
    }));
    setCloseoutForm({ quoteId: "", invoiceTotal: 0, actualHours: 2, completionNote: "" });
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
        <div className="topbar-actions">
          <a className="header-cta primary" href="https://321honeydone.com" target="_blank" rel="noreferrer">Request Estimate</a>
          <a className="header-cta ghost" href="tel:3213238047">Text Photos</a>
        </div>
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
                {appState.quotes.length ? appState.quotes.slice(0, 4).map((quote) => <div className="pipeline-item" key={quote.id}><span>{quote.id}</span><strong>{quote.clientName}</strong><p>{quote.service} in {quote.address || "Brevard County"}.</p><span>{quote.status}</span></div>) : <div className="empty-state">No quotes yet. Build one in the Quote Builder tab.</div>}
              </div>
            </article>
          </div>
        </section>}

        {activeTab === "quotes" && <section className="panel is-active">
          <div className="two-column">
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">New Quote</p><h3>Build a flat-rate estimate</h3></div></div>
              <form className="form-stack" onSubmit={saveQuote}>
                <label><span>Active client list</span><select name="activeClient" value="" onChange={onClientPick}><option value="">Select active client...</option>{activeClients.map((client) => <option key={`${client.name}-${client.address}`} value={client.name}>{client.name}{client.city ? ` - ${client.city}` : ""}</option>)}</select></label>
                <label><span>Customer name</span><input name="clientName" value={quoteForm.clientName} onChange={onQuoteField} placeholder="Sharon Levasseur" required /></label>
                <label><span>Property address</span><input name="address" value={quoteForm.address} onChange={onQuoteField} placeholder="3830 Pine Cone Road, Melbourne FL" /></label>
                <div className="form-split">
                  <label><span>Service category</span><select name="service" value={quoteForm.service} onChange={onQuoteField}>{serviceCatalog.map((service) => <option key={service.name} value={service.name}>{service.name}</option>)}</select></label>
                  <label><span>Urgency</span><select name="urgency" value={quoteForm.urgency} onChange={onQuoteField}><option value="standard">Standard</option><option value="priority">Priority</option><option value="emergency">Emergency</option></select></label>
                </div>
                <div className="form-split">
                  <label><span>Estimated labor hours</span><input name="hours" type="number" min="1" max="24" value={quoteForm.hours} onChange={onQuoteField} required /></label>
                  <label><span>Materials cost</span><input name="materials" type="number" min="0" step="1" value={quoteForm.materials} onChange={onQuoteField} required /></label>
                </div>
                <label><span>Scope notes</span><textarea name="scope" rows="5" value={quoteForm.scope} onChange={onQuoteField} placeholder="Swap damaged screen, reset loose frame, test operation, and clean work area." /></label>
                <button className="primary-button" type="submit">Generate Quote</button>
              </form>
            </article>
            <article className="card accent-card">
              <div className="card-header"><div><p className="section-kicker">Estimate Preview</p><h3>Quote summary</h3></div></div>
              <div className="quote-preview">
                <span>Live preview</span>
                <strong>{quoteForm.clientName || "Customer name pending"}</strong>
                <p>{quoteForm.scope || "Scope note pending."}</p>
                <div className="preview-total">{money(quotePreview.total)}</div>
                <div className="quote-breakdown">
                  <div><span>Labor</span><strong>{money(quotePreview.labor)}</strong></div>
                  <div><span>Trip Fee</span><strong>{money(quotePreview.tripFee)}</strong></div>
                  <div><span>Materials</span><strong>{money(quoteForm.materials)}</strong></div>
                  <div><span>Contingency</span><strong>{money(quotePreview.contingency)}</strong></div>
                </div>
                <div className="mini-panel"><span>Recommended Prep</span><p>{quotePreview.prep.join(", ")}</p></div>
              </div>
            </article>
          </div>
          <article className="card">
            <div className="card-header"><div><p className="section-kicker">Saved Quotes</p><h3>Recent field-ready estimates</h3></div></div>
            <div className="saved-list">{appState.quotes.length ? appState.quotes.slice().reverse().map((quote) => <article className="saved-item" key={quote.id}><span>{quote.id}</span><strong>{quote.clientName} - {quote.service}</strong><p>{quote.address || "Address not set"}</p><p>{money(quote.total)} - {quote.status}</p></article>) : <div className="empty-state">No saved quotes yet.</div>}</div>
          </article>
        </section>}

        {activeTab === "prep" && <section className="panel is-active">
          <div className="two-column">
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Mission Brief</p><h3>Load the truck with intent</h3></div></div>
              {activeQuote ? <div className="prep-summary"><span>{activeQuote.id}</span><strong>{activeQuote.clientName}</strong><p>{activeQuote.service} at {activeQuote.address || "Brevard County property"}.</p><div className="prep-grid"><div><span>Trip Fee</span><strong>{money(activeQuote.tripFee)}</strong></div><div><span>Estimated Hours</span><strong>{activeQuote.hours}</strong></div><div><span>Priority</span><strong>{activeQuote.urgency}</strong></div></div><div className="mini-panel"><span>Truck Loadout</span><p>{activeQuote.prep.join(", ")}</p></div></div> : <div className="empty-state">Save a quote first to generate the mission brief.</div>}
            </article>
            <article className="card">
              <div className="card-header"><div><p className="section-kicker">Departure Checklist</p><h3>No forgotten gear</h3></div></div>
              <div className="checklist">{checklistItems.map((item, index) => <label className={`check-item ${checks[index] ? "is-done" : ""}`} key={item}><input type="checkbox" checked={checks[index]} onChange={() => setChecks((current) => current.map((value, currentIndex) => currentIndex === index ? !value : value))} /><span>{item}</span></label>)}</div>
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
                <button className="primary-button" type="submit" disabled={!appState.quotes.length}>Save Closeout</button>
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
                <p>Active client feed: {activeClients.length} records loaded.</p>
                <p>Full client feed: {allClients.length} records loaded.</p>
                {dataQualityMessage ? <p>{dataQualityMessage}</p> : <p>Phone and email data are available for {reachableClients} client records.</p>}
              </div>
              <div className="quick-links">{quickLinks.map((item) => <a className="quick-link" href={item.href} key={item.label} target={item.href.startsWith("http") ? "_blank" : undefined} rel={item.href.startsWith("http") ? "noreferrer" : undefined}><div><span>{item.meta}</span><strong>{item.label}</strong></div><em>Open</em></a>)}</div>
            </article>
          </div>
        </section>}
      </main>
    </div>
  );
}
