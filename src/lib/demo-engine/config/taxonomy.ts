import { RequestType } from "../types";

// ─── Service Definition ───────────────────────────────────────────────────────

export interface ServiceDefinition {
  id: string;
  displayName: string;
  trade: string;
  supportedRequestTypes: RequestType[];
  requiredFields: string[];      // fields needed beyond base (name/phone/address)
  optionalFields: string[];
  aliases: string[];             // natural-language phrases that map to this service
  clarificationHints: string[];  // hints for when the service is ambiguous
  relevantDiagnosticQuestions: string[];
}

// ─── Field Policy ─────────────────────────────────────────────────────────────

export interface FieldPolicy {
  field: string;
  required: boolean;
  requiredFor: RequestType[];  // if non-empty, only required for these request types
  optional: boolean;
  neverRequired: boolean;
}

// ─── Trade Config ─────────────────────────────────────────────────────────────

export type TradeConfig = Record<string, ServiceDefinition[]>;

// ─── HVAC Service Catalog ─────────────────────────────────────────────────────

const HVAC_SERVICES: ServiceDefinition[] = [
  {
    id: "AC_REPAIR",
    displayName: "AC Repair",
    trade: "HVAC",
    supportedRequestTypes: ["REPAIR", "EMERGENCY", "DIAGNOSTIC"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "ac repair", "air conditioner repair", "air conditioning repair",
      "fix ac", "fix air conditioner", "fix air conditioning",
      "ac broken", "air conditioner broken", "ac not working",
      "ac stopped working", "air conditioner stopped working",
      "ac not cooling", "not cooling", "blowing warm air", "warm air",
      "air not cold", "ac not cold", "ac died", "air conditioner died",
      "ac problem", "ac issue", "broken ac", "broken air conditioner",
      "ac makes noise", "ac noisy", "ac leaking", "ac dripping",
      "hvac repair", "hvac not working", "unit not working",
      "cooling problem", "cooling issue", "no cooling",
      "ac service repair", "repair my ac", "repair air conditioner"
    ],
    clarificationHints: ["What symptoms is the unit showing?", "Is it making any unusual noises?"],
    relevantDiagnosticQuestions: ["How long has it been since it stopped cooling?", "Is there ice forming on the unit?"]
  },
  {
    id: "AC_INSTALLATION",
    displayName: "AC Installation",
    trade: "HVAC",
    supportedRequestTypes: ["INSTALLATION", "REPLACEMENT", "ESTIMATE"],
    requiredFields: ["urgency"],
    optionalFields: ["timing", "equipment", "context"],
    aliases: [
      "ac installation", "air conditioner installation", "air conditioning installation",
      "install ac", "install air conditioner", "install air conditioning",
      "ac install", "new ac", "new air conditioner", "new unit",
      "put ac in", "put my ac in", "put in ac", "put in air conditioner",
      "hook up ac", "hook up air conditioner", "hook up my unit",
      "set up ac", "set up air conditioner", "set up new ac",
      "ac was delivered", "new ac delivered", "unit was delivered",
      "just got ac", "just got air conditioner", "just bought ac",
      "just purchased ac", "bought new ac", "purchased new ac",
      "need someone to install", "need installation", "ac unit installation",
      "system installation", "install the unit", "install my unit",
      "put the new ac", "install the new ac", "air conditioner install",
      "install my air conditioner", "install new air conditioner",
      "hvac installation", "cooling installation", "new system install",
      "ac replacement installation", "replacing my ac"
    ],
    clarificationHints: ["Is the new unit already on site?", "What size unit do you have?"],
    relevantDiagnosticQuestions: ["Is this a new installation or replacing an existing unit?"]
  },
  {
    id: "AC_MAINTENANCE",
    displayName: "AC Maintenance / Tune-up",
    trade: "HVAC",
    supportedRequestTypes: ["MAINTENANCE", "INSPECTION"],
    requiredFields: ["urgency"],
    optionalFields: ["timing"],
    aliases: [
      "ac maintenance", "air conditioner maintenance", "air conditioning maintenance",
      "ac tune up", "ac tune-up", "air conditioner tune up",
      "service my ac", "service air conditioner", "ac service",
      "ac checkup", "ac check up", "ac check",
      "ac inspection", "air conditioner inspection",
      "ac cleaning", "clean my ac", "ac filter",
      "hvac maintenance", "hvac service", "hvac tune up",
      "annual maintenance", "annual service", "seasonal maintenance",
      "winter service", "summer service", "preventive maintenance",
      "ac serviced", "get ac serviced", "have ac serviced"
    ],
    clarificationHints: ["Is this a routine service or do you have concerns?"],
    relevantDiagnosticQuestions: ["When was the last time the unit was serviced?"]
  },
  {
    id: "AC_REPLACEMENT",
    displayName: "AC Replacement",
    trade: "HVAC",
    supportedRequestTypes: ["REPLACEMENT", "ESTIMATE"],
    requiredFields: ["urgency"],
    optionalFields: ["timing", "equipment", "context"],
    aliases: [
      "ac replacement", "air conditioner replacement", "replace ac",
      "replace air conditioner", "new ac system", "replace old ac",
      "upgrade ac", "upgrade air conditioner", "swap ac",
      "full ac replacement", "complete ac replacement", "replace hvac",
      "replace the unit", "replace my unit", "replace whole system",
      "get new ac", "want new ac", "want to replace my ac"
    ],
    clarificationHints: ["Are you looking to replace the entire system or just the unit?"],
    relevantDiagnosticQuestions: ["How old is the current unit?"]
  },
  {
    id: "HEATING_REPAIR",
    displayName: "Heating Repair",
    trade: "HVAC",
    supportedRequestTypes: ["REPAIR", "EMERGENCY", "DIAGNOSTIC"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "heating repair", "heater repair", "furnace repair",
      "heat not working", "no heat", "heater not working",
      "furnace not working", "furnace broken", "heat broke",
      "heating problem", "heating issue", "furnace problem",
      "fix heater", "fix furnace", "fix heating",
      "boiler repair", "heat pump repair"
    ],
    clarificationHints: ["Is this a furnace, boiler, or heat pump?"],
    relevantDiagnosticQuestions: ["Is it blowing cold air or no air at all?"]
  },
  {
    id: "FURNACE_INSTALLATION",
    displayName: "Furnace Installation",
    trade: "HVAC",
    supportedRequestTypes: ["INSTALLATION", "REPLACEMENT", "ESTIMATE"],
    requiredFields: ["urgency"],
    optionalFields: ["timing", "equipment"],
    aliases: [
      "furnace installation", "install furnace", "new furnace",
      "furnace replacement", "replace furnace", "furnace install",
      "heater installation", "heating installation", "install heater",
      "heat pump installation", "install heat pump",
      "boiler installation", "install boiler"
    ],
    clarificationHints: ["What type of heating system do you currently have?"],
    relevantDiagnosticQuestions: ["Is this replacing an existing system?"]
  },
  {
    id: "THERMOSTAT_SERVICE",
    displayName: "Thermostat Service",
    trade: "HVAC",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "REPLACEMENT", "ESTIMATE"],
    requiredFields: ["urgency"],
    optionalFields: ["problem", "timing"],
    aliases: [
      "thermostat", "thermostat repair", "thermostat not working",
      "thermostat broken", "thermostat installation", "install thermostat",
      "new thermostat", "replace thermostat", "thermostat replacement",
      "smart thermostat", "programmable thermostat", "thermostat issue"
    ],
    clarificationHints: ["Is this a repair or new installation?"],
    relevantDiagnosticQuestions: ["Is the display working?"]
  },
  {
    id: "DUCTWORK",
    displayName: "Ductwork Service",
    trade: "HVAC",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "INSPECTION", "ESTIMATE"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "ductwork", "duct repair", "ducts", "duct cleaning",
      "airflow problem", "poor airflow", "no airflow", "weak airflow",
      "duct installation", "new ductwork", "duct replacement",
      "air ducts", "ventilation"
    ],
    clarificationHints: ["Which rooms are having the airflow issues?"],
    relevantDiagnosticQuestions: ["Are specific rooms not getting airflow?"]
  },
  {
    id: "HVAC_ESTIMATE",
    displayName: "HVAC Estimate",
    trade: "HVAC",
    supportedRequestTypes: ["ESTIMATE"],
    requiredFields: ["urgency"],
    optionalFields: ["context", "timing"],
    aliases: [
      "hvac estimate", "ac estimate", "how much does it cost",
      "price for ac", "cost of ac", "quote for ac",
      "estimate for ac", "estimate for hvac", "hvac quote",
      "cost to replace ac", "price to install ac", "pricing"
    ],
    clarificationHints: ["What service are you looking to get an estimate for?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "OTHER_HVAC",
    displayName: "Other HVAC Service",
    trade: "HVAC",
    supportedRequestTypes: ["OTHER", "UNKNOWN", "GENERAL_SERVICE"],
    requiredFields: ["problem", "urgency"],
    optionalFields: [],
    aliases: [],
    clarificationHints: ["Can you describe what you need help with?"],
    relevantDiagnosticQuestions: []
  }
];

// ─── Plumbing Service Catalog ─────────────────────────────────────────────────

const PLUMBING_SERVICES: ServiceDefinition[] = [
  {
    id: "LEAK_REPAIR",
    displayName: "Leak Repair",
    trade: "PLUMBING",
    supportedRequestTypes: ["REPAIR", "EMERGENCY"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "leak", "leaking", "leak repair", "fix leak", "water leak",
      "pipe leak", "leaking pipe", "pipe leaking", "water dripping",
      "dripping water", "leaking faucet", "faucet leak",
      "leaking toilet", "toilet leak", "water damage",
      "burst pipe", "pipe burst", "broken pipe", "cracked pipe",
      "leaking under sink", "under sink leak", "ceiling leak",
      "water coming from ceiling", "flooding", "water everywhere"
    ],
    clarificationHints: ["Where is the leak coming from?"],
    relevantDiagnosticQuestions: ["How severe is the leak?", "Have you shut off the water?"]
  },
  {
    id: "DRAIN_CLEANING",
    displayName: "Drain Cleaning",
    trade: "PLUMBING",
    supportedRequestTypes: ["REPAIR", "MAINTENANCE"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "drain", "clogged drain", "blocked drain", "slow drain",
      "drain cleaning", "unclog drain", "drain clog",
      "drain blocked", "sink clog", "bathtub clog", "shower clog",
      "toilet clog", "clogged toilet", "toilet blocked",
      "sewage backup", "sewer backup", "drain backup",
      "backed up drain", "drain slow", "slow draining"
    ],
    clarificationHints: ["Which drain is clogged?"],
    relevantDiagnosticQuestions: ["Is it a single drain or multiple?"]
  },
  {
    id: "WATER_HEATER_REPAIR",
    displayName: "Water Heater Repair",
    trade: "PLUMBING",
    supportedRequestTypes: ["REPAIR", "EMERGENCY"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "water heater repair", "fix water heater", "hot water heater repair",
      "no hot water", "no hot water at all", "water not hot",
      "water heater broken", "water heater not working",
      "cold water only", "hot water issue", "hot water problem",
      "water heater leak", "leaking water heater", "water heater dripping",
      "hot water heater not working", "boiler repair"
    ],
    clarificationHints: ["Is it gas or electric?"],
    relevantDiagnosticQuestions: ["How long has there been no hot water?"]
  },
  {
    id: "WATER_HEATER_INSTALLATION",
    displayName: "Water Heater Installation",
    trade: "PLUMBING",
    supportedRequestTypes: ["INSTALLATION", "REPLACEMENT", "ESTIMATE"],
    requiredFields: ["urgency"],
    optionalFields: ["timing", "equipment"],
    aliases: [
      "water heater installation", "install water heater", "new water heater",
      "water heater replacement", "replace water heater",
      "tankless water heater", "install tankless", "hot water heater installation"
    ],
    clarificationHints: ["Are you replacing an existing unit or new installation?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "TOILET_SERVICE",
    displayName: "Toilet Service",
    trade: "PLUMBING",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "REPLACEMENT"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "toilet", "toilet repair", "toilet not flushing", "toilet running",
      "toilet overflowing", "toilet overflow", "running toilet",
      "toilet broken", "toilet installation", "new toilet",
      "replace toilet", "toilet replacement", "toilet clog",
      "clogged toilet"
    ],
    clarificationHints: ["Is it a repair or replacement?"],
    relevantDiagnosticQuestions: ["Is it running constantly or won't flush?"]
  },
  {
    id: "FAUCET_SERVICE",
    displayName: "Faucet Service",
    trade: "PLUMBING",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "REPLACEMENT"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "faucet", "faucet repair", "faucet dripping", "dripping faucet",
      "leaking faucet", "fix faucet", "faucet installation",
      "new faucet", "replace faucet", "kitchen faucet", "bathroom faucet",
      "tap repair", "tap replacement"
    ],
    clarificationHints: ["Which faucet is having the issue?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "SUMP_PUMP",
    displayName: "Sump Pump Service",
    trade: "PLUMBING",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "REPLACEMENT"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "sump pump", "sump pump repair", "sump pump not working",
      "sump pump installation", "install sump pump", "new sump pump",
      "basement flooding", "basement water", "sump pump replacement"
    ],
    clarificationHints: ["Is it not running at all or running constantly?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "SEWER_SERVICE",
    displayName: "Sewer / Main Line Service",
    trade: "PLUMBING",
    supportedRequestTypes: ["REPAIR", "INSPECTION", "EMERGENCY"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "sewer", "sewer line", "main line", "sewer repair",
      "sewer clog", "sewer backup", "main line clog",
      "sewage smell", "sewer smell", "sewer problem",
      "drain field", "septic"
    ],
    clarificationHints: ["Is there a sewage odor or backup?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "PIPE_SERVICE",
    displayName: "Pipe Service",
    trade: "PLUMBING",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "REPLACEMENT", "ESTIMATE"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "pipe repair", "pipes", "pipe replacement", "replace pipes",
      "repiping", "new pipes", "pipe installation",
      "frozen pipe", "frozen pipes", "thaw pipes"
    ],
    clarificationHints: ["What type of pipe issue are you experiencing?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "OTHER_PLUMBING",
    displayName: "Other Plumbing Service",
    trade: "PLUMBING",
    supportedRequestTypes: ["OTHER", "UNKNOWN", "GENERAL_SERVICE"],
    requiredFields: ["problem", "urgency"],
    optionalFields: [],
    aliases: [],
    clarificationHints: ["Can you describe what you need help with?"],
    relevantDiagnosticQuestions: []
  }
];

// ─── Electrical Service Catalog ────────────────────────────────────────────────

const ELECTRICAL_SERVICES: ServiceDefinition[] = [
  {
    id: "OUTLET_REPAIR",
    displayName: "Outlet Repair",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["REPAIR"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "outlet", "outlet repair", "outlet not working", "outlet broken",
      "fix outlet", "dead outlet", "no power outlet",
      "outlet sparking", "sparking outlet", "burnt outlet",
      "gfci", "gfci not working", "gfci tripped",
      "receptacle", "plug not working", "socket not working"
    ],
    clarificationHints: ["Which outlet is not working?"],
    relevantDiagnosticQuestions: ["Is it one outlet or multiple?"]
  },
  {
    id: "BREAKER_PANEL",
    displayName: "Breaker / Panel Service",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["REPAIR", "UPGRADE", "EMERGENCY", "ESTIMATE"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "breaker", "breaker repair", "breaker tripping", "circuit breaker",
      "panel", "electrical panel", "panel upgrade", "panel replacement",
      "fuse box", "fuse box replacement", "main panel",
      "breaker won't reset", "breaker keeps tripping", "no power",
      "power outage", "lost power", "power went out",
      "electrical upgrade", "200 amp upgrade", "panel installation"
    ],
    clarificationHints: ["Is it a breaker that keeps tripping or full panel issue?"],
    relevantDiagnosticQuestions: ["Which circuit is having the problem?"]
  },
  {
    id: "WIRING_SERVICE",
    displayName: "Wiring Service",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "UPGRADE", "ESTIMATE"],
    requiredFields: ["problem", "urgency"],
    optionalFields: ["timing"],
    aliases: [
      "wiring", "wiring repair", "rewiring", "electrical wiring",
      "wire repair", "old wiring", "aluminum wiring",
      "faulty wiring", "bad wiring", "wiring issue"
    ],
    clarificationHints: ["Is this a repair or new wiring installation?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "LIGHTING_SERVICE",
    displayName: "Lighting Service",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "REPLACEMENT"],
    requiredFields: ["urgency"],
    optionalFields: ["problem", "timing"],
    aliases: [
      "lighting", "lights", "light repair", "light installation",
      "install lights", "new lighting", "light not working",
      "lights flickering", "flickering lights", "light fixture",
      "fixture installation", "led lighting", "recessed lighting",
      "ceiling light", "outdoor lighting", "porch light"
    ],
    clarificationHints: ["Is this a repair or installation of new lighting?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "EV_CHARGER",
    displayName: "EV Charger Installation",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["INSTALLATION", "ESTIMATE"],
    requiredFields: ["urgency"],
    optionalFields: ["timing", "equipment"],
    aliases: [
      "ev charger", "electric vehicle charger", "ev charging",
      "install ev charger", "car charger", "electric car charger",
      "level 2 charger", "level 2 charging", "home charger"
    ],
    clarificationHints: ["What type of vehicle do you have?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "GENERATOR",
    displayName: "Generator Service",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["INSTALLATION", "REPAIR", "ESTIMATE"],
    requiredFields: ["urgency"],
    optionalFields: ["problem", "timing"],
    aliases: [
      "generator", "generator installation", "install generator",
      "standby generator", "whole home generator", "generator repair",
      "generator not working", "backup power"
    ],
    clarificationHints: ["Is this a new installation or repair?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "SWITCH_FAN",
    displayName: "Switch / Fan Service",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["REPAIR", "INSTALLATION", "REPLACEMENT"],
    requiredFields: ["urgency"],
    optionalFields: ["problem", "timing"],
    aliases: [
      "switch", "light switch", "switch repair", "switch not working",
      "ceiling fan", "fan installation", "install fan", "fan repair",
      "fan not working", "ceiling fan not working", "fan replacement",
      "dimmer switch", "smart switch"
    ],
    clarificationHints: ["Is this a switch repair or fan installation?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "ELECTRICAL_INSPECTION",
    displayName: "Electrical Inspection",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["INSPECTION", "DIAGNOSTIC"],
    requiredFields: ["urgency"],
    optionalFields: ["timing", "context"],
    aliases: [
      "electrical inspection", "inspect electrical", "electrical safety inspection",
      "home inspection", "electrical checkup", "electrical diagnostic",
      "code inspection", "permit inspection"
    ],
    clarificationHints: ["Is this for a home purchase or a safety concern?"],
    relevantDiagnosticQuestions: []
  },
  {
    id: "OTHER_ELECTRICAL",
    displayName: "Other Electrical Service",
    trade: "ELECTRICAL",
    supportedRequestTypes: ["OTHER", "UNKNOWN", "GENERAL_SERVICE"],
    requiredFields: ["problem", "urgency"],
    optionalFields: [],
    aliases: [],
    clarificationHints: ["Can you describe what you need help with?"],
    relevantDiagnosticQuestions: []
  }
];

// ─── Master Catalog ───────────────────────────────────────────────────────────

export const ServiceCatalog: TradeConfig = {
  HVAC: HVAC_SERVICES,
  PLUMBING: PLUMBING_SERVICES,
  ELECTRICAL: ELECTRICAL_SERVICES,
};

/** Look up a service definition by catalog ID */
export function getServiceById(trade: string, serviceId: string): ServiceDefinition | undefined {
  return ServiceCatalog[trade]?.find(s => s.id === serviceId);
}

/** Get all services for a trade */
export function getServicesForTrade(trade: string): ServiceDefinition[] {
  return ServiceCatalog[trade] ?? [];
}

/** Find a service by alias match (case-insensitive substring) */
export function findServiceByAlias(trade: string, text: string): ServiceDefinition | undefined {
  const normalized = text.toLowerCase().trim();
  const services = ServiceCatalog[trade] ?? [];

  // 1. Exact alias match
  for (const svc of services) {
    if (svc.aliases.some(alias => alias === normalized)) {
      return svc;
    }
  }

  // 2. Partial alias match (alias is contained in the utterance)
  for (const svc of services) {
    if (svc.aliases.some(alias => {
      // Use word boundaries to prevent 'ac' matching inside 'black' or 'fact'
      const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
      return regex.test(normalized);
    })) {
      return svc;
    }
  }

  // 3. Display name match
  for (const svc of services) {
    if (normalized.includes(svc.displayName.toLowerCase())) {
      return svc;
    }
  }

  return undefined;
}

/** Map a request type string to canonical RequestType */
export const REQUEST_TYPE_ALIASES: Record<string, string> = {
  "repair": "REPAIR",
  "fix": "REPAIR",
  "broken": "REPAIR",
  "not working": "REPAIR",
  "install": "INSTALLATION",
  "installation": "INSTALLATION",
  "installing": "INSTALLATION",
  "set up": "INSTALLATION",
  "setup": "INSTALLATION",
  "hook up": "INSTALLATION",
  "hookup": "INSTALLATION",
  "put in": "INSTALLATION",
  "put my": "INSTALLATION",
  "replace": "REPLACEMENT",
  "replacement": "REPLACEMENT",
  "replacing": "REPLACEMENT",
  "new unit": "INSTALLATION",
  "maintain": "MAINTENANCE",
  "maintenance": "MAINTENANCE",
  "service": "MAINTENANCE",
  "tune up": "MAINTENANCE",
  "tune-up": "MAINTENANCE",
  "inspect": "INSPECTION",
  "inspection": "INSPECTION",
  "diagnose": "DIAGNOSTIC",
  "diagnostic": "DIAGNOSTIC",
  "look at": "DIAGNOSTIC",
  "check out": "DIAGNOSTIC",
  "upgrade": "UPGRADE",
  "estimate": "ESTIMATE",
  "quote": "ESTIMATE",
  "how much": "ESTIMATE",
  "cost": "ESTIMATE",
  "price": "ESTIMATE",
  "emergency": "EMERGENCY",
  "urgent": "EMERGENCY",
  "asap": "EMERGENCY",
  "right now": "EMERGENCY"
};
