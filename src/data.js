export const storageKey = "honeydone-command-center-v3";
export const appsScriptUrl = "https://script.google.com/macros/s/AKfycbyYILvYLvSYwNVMyr1YNj1C6O5OKYUAYZqSJfRBy9MeVHbCeFgICMblIX0_bTrOabFK/exec";

export const serviceCatalog = [
  { name: "General Repairs", base: 145, trip: 65, prep: ["Fastener kit", "Driver set", "Touch-up supplies"] },
  { name: "Doors & Hardware", base: 165, trip: 65, prep: ["Hinge assortment", "Driver set", "Shims"] },
  { name: "Minor Electrical", base: 185, trip: 75, prep: ["Tester", "Wire nuts", "Cover plates"] },
  { name: "Minor Plumbing", base: 195, trip: 75, prep: ["Supply lines", "Sealant", "Channel locks"] },
  { name: "Drywall & Paint", base: 175, trip: 65, prep: ["Patch kit", "Knife set", "Drop cloth"] },
  { name: "Windows & Screens", base: 170, trip: 65, prep: ["Spline", "Roller tool", "Screen material"] },
  { name: "Exterior & Masonry", base: 225, trip: 85, prep: ["Masonry anchors", "Brushes", "Surface protection"] },
  { name: "Pressure Washing", base: 210, trip: 75, prep: ["Hose check", "Nozzle set", "Cleaner"] }
];

export const serviceZones = [
  "Melbourne",
  "Palm Bay",
  "Viera",
  "West Melbourne",
  "Indialantic",
  "Satellite Beach",
  "Cocoa",
  "Merritt Island"
];

export const quickLinks = [
  { label: "HoneyDone Main Line", meta: "(321) 323-8047", href: "tel:3213238047" },
  { label: "Website", meta: "321honeydone.com", href: "https://321honeydone.com" },
  { label: "Client Hub", meta: "Jobber customer portal", href: "https://clienthub.getjobber.com/client_hubs/6d40d362-d58e-4877-8ac2-e238a492cc69/login/new" },
  { label: "Request Estimate", meta: "Fast intake", href: "https://321honeydone.com" }
];

export const defaultState = {
  quotes: [
    {
      id: "HD-24031",
      clientName: "Sharon Levasseur",
      address: "3830 Pine Cone Road, Melbourne FL",
      service: "Doors & Hardware",
      urgency: "standard",
      hours: 2,
      materials: 85,
      scope: "Reset front entry hardware, tighten strike alignment, and verify latch operation.",
      total: 488,
      labor: 329,
      tripFee: 65,
      contingency: 9,
      prep: ["Hinge assortment", "Driver set", "Shims"],
      status: "Needs Scheduling"
    },
    {
      id: "HD-24032",
      clientName: "Monique Rivera",
      address: "256 Peckham St NE, Palm Bay FL",
      service: "Windows & Screens",
      urgency: "priority",
      hours: 3,
      materials: 120,
      scope: "Replace torn patio screen and inspect frame tension on adjacent panel.",
      total: 655,
      labor: 443,
      tripFee: 80,
      contingency: 12,
      prep: ["Spline", "Roller tool", "Screen material"],
      status: "Awaiting Approval"
    }
  ],
  closeouts: []
};
