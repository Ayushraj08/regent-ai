export type RequestType = 
  | "REPAIR"
  | "INSTALLATION"
  | "REPLACEMENT"
  | "MAINTENANCE"
  | "INSPECTION"
  | "DIAGNOSTIC"
  | "UPGRADE"
  | "ESTIMATE"
  | "GENERAL_SERVICE"
  | "EMERGENCY"
  | "OTHER"
  | "UNKNOWN";

export interface ServiceDefinition {
  id: string;
  displayName: string;
  requestTypes: RequestType[];
  requiredFields: string[];
  optionalFields: string[];
}

export type TradeConfig = {
  [tradeName: string]: ServiceDefinition[];
};

export const ServiceCatalog: TradeConfig = {
  HVAC: [
    {
      id: "AC_REPAIR",
      displayName: "AC Repair",
      requestTypes: ["REPAIR", "EMERGENCY", "DIAGNOSTIC"],
      requiredFields: ["problem", "urgency"],
      optionalFields: ["symptoms"]
    },
    {
      id: "AC_INSTALLATION",
      displayName: "AC Installation",
      requestTypes: ["INSTALLATION", "REPLACEMENT", "ESTIMATE"],
      requiredFields: ["urgency"], // Note: 'problem' is NOT required
      optionalFields: ["context"]
    },
    {
      id: "AC_MAINTENANCE",
      displayName: "AC Maintenance",
      requestTypes: ["MAINTENANCE", "INSPECTION"],
      requiredFields: ["urgency"], // 'problem' is NOT required
      optionalFields: []
    },
    {
      id: "HEATING_REPAIR",
      displayName: "Heating Repair",
      requestTypes: ["REPAIR", "EMERGENCY", "DIAGNOSTIC"],
      requiredFields: ["problem", "urgency"],
      optionalFields: ["symptoms"]
    },
    {
      id: "FURNACE_INSTALLATION",
      displayName: "Furnace Installation",
      requestTypes: ["INSTALLATION", "REPLACEMENT", "ESTIMATE"],
      requiredFields: ["urgency"],
      optionalFields: ["context"]
    },
    {
      id: "OTHER_HVAC",
      displayName: "Other HVAC Service",
      requestTypes: ["OTHER", "UNKNOWN"],
      requiredFields: ["problem", "urgency"],
      optionalFields: []
    }
  ],
  PLUMBING: [
    {
      id: "LEAK_REPAIR",
      displayName: "Leak Repair",
      requestTypes: ["REPAIR", "EMERGENCY"],
      requiredFields: ["problem", "urgency"],
      optionalFields: ["symptoms"]
    },
    {
      id: "DRAIN_CLEANING",
      displayName: "Drain Cleaning",
      requestTypes: ["REPAIR", "MAINTENANCE"],
      requiredFields: ["problem", "urgency"],
      optionalFields: []
    },
    {
      id: "WATER_HEATER_REPAIR",
      displayName: "Water Heater Repair",
      requestTypes: ["REPAIR", "EMERGENCY"],
      requiredFields: ["problem", "urgency"],
      optionalFields: []
    },
    {
      id: "WATER_HEATER_INSTALLATION",
      displayName: "Water Heater Installation",
      requestTypes: ["INSTALLATION", "REPLACEMENT", "ESTIMATE"],
      requiredFields: ["urgency"],
      optionalFields: []
    },
    {
      id: "OTHER_PLUMBING",
      displayName: "Other Plumbing Service",
      requestTypes: ["OTHER", "UNKNOWN"],
      requiredFields: ["problem", "urgency"],
      optionalFields: []
    }
  ],
  ELECTRICAL: [
    {
      id: "OUTLET_REPAIR",
      displayName: "Outlet Repair",
      requestTypes: ["REPAIR"],
      requiredFields: ["problem", "urgency"],
      optionalFields: []
    },
    {
      id: "BREAKER_PANEL",
      displayName: "Breaker/Panel Service",
      requestTypes: ["REPAIR", "UPGRADE", "EMERGENCY", "ESTIMATE"],
      requiredFields: ["problem", "urgency"],
      optionalFields: []
    },
    {
      id: "LIGHTING_INSTALLATION",
      displayName: "Lighting Installation",
      requestTypes: ["INSTALLATION", "REPLACEMENT"],
      requiredFields: ["urgency"],
      optionalFields: []
    },
    {
      id: "OTHER_ELECTRICAL",
      displayName: "Other Electrical Service",
      requestTypes: ["OTHER", "UNKNOWN"],
      requiredFields: ["problem", "urgency"],
      optionalFields: []
    }
  ]
};
