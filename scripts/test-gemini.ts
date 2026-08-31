import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function run() {
  console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 5) + "..." : "missing");
  
  const ai = new GoogleGenAI({
    apiKey: "ya29.c.c0AYos-jU"
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Hello",
    });
    console.log("Success:", response.text);
  } catch (error) {
    console.error("Error:");
    console.error(error);
  }
}

run();
