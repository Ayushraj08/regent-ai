const req = {
  "state": "START",
  "trade": "HVAC",
  "lead": {
    "name": { "value": null, "status": "MISSING", "confidence": 0, "turn": 0 },
    "phone": { "value": null, "status": "MISSING", "confidence": 0, "turn": 0 },
    "address": { "value": null, "status": "MISSING", "confidence": 0, "turn": 0 },
    "service": { "value": null, "status": "MISSING", "confidence": 0, "turn": 0 },
    "problem": { "value": null, "status": "MISSING", "confidence": 0, "turn": 0 },
    "urgency": { "value": null, "status": "MISSING", "confidence": 0, "turn": 0 },
    "trade": "HVAC"
  },
  "utterance": "I smell gas near the furnace.",
  "conversationHistory": [],
  "turnCount": 1
};

fetch("http://localhost:3000/api/demo/respond", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(req)
})
.then(res => res.json())
.then(data => console.log(JSON.stringify(data, null, 2)))
.catch(err => console.error(err));
