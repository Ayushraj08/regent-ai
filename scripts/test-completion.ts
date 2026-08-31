import { config } from 'dotenv';
config({ path: '.env.local' });
import { processDemoUtterance } from '../src/lib/demo-engine/state-machine';

async function run() {
  let req: any = {
    state: 'START',
    trade: 'HVAC',
    lead: {
      name: { value: 'Ayush', status: 'CAPTURED', confidence: 1, turn: 1 },
      phone: { value: '1234567890', status: 'CAPTURED', confidence: 1, turn: 1 },
      address: { value: '123 Main St', status: 'CAPTURED', confidence: 1, turn: 1 },
      service: { value: 'Repair', status: 'CAPTURED', confidence: 1, turn: 1 },
      problem: { value: 'Broken AC', status: 'CAPTURED', confidence: 1, turn: 1 },
      urgency: { value: 'HIGH', status: 'CAPTURED', confidence: 1, turn: 1 },
      trade: 'HVAC'
    },
    conversationHistory: [],
    turnCount: 1
  };

  console.log("Turn: Address capture complete (pretend request.state was URGENCY)");
  req.state = 'URGENCY';
  req.utterance = 'Yes, that is all.';
  
  let res = await processDemoUtterance(req, 't1');
  console.log("Response Type:", res.responseType);
  console.log("Response Text:", res.response);
  console.log("Next State:", res.state);
  
  req.state = res.state;
  req.utterance = 'No';
  res = await processDemoUtterance(req, 't2');
  console.log("Response Type:", res.responseType);
  console.log("Response Text:", res.response);
  console.log("Next State:", res.state);

  req.state = res.state;
  req.utterance = 'No';
  res = await processDemoUtterance(req, 't3');
  console.log("Response Type:", res.responseType);
  console.log("Response Text:", res.response);
  console.log("Next State:", res.state);
  
  req.state = res.state;
  req.utterance = 'Yes';
  res = await processDemoUtterance(req, 't4');
  console.log("Response Type:", res.responseType);
  console.log("Response Text:", res.response);
  console.log("Next State:", res.state);
}
run();
