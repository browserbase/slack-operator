import { NextResponse } from "next/server";
import { Browserbase } from "@browserbasehq/sdk";
import { runAgentLoop } from "../slack/operator";
import { Agent } from "../agent/agent";
import { BrowserbaseBrowser } from "../agent/browserbase";
import { getClosestRegion } from "./util";

// Set the default to 60 seconds. This is not enough!
// Once you enable Fluid Compute, you can can set this to 800 seconds.
export const maxDuration = 60;

// Initialize Browserbase client
const validateEnvironment = () => {
  if (!process.env.BROWSERBASE_API_KEY) {
    throw new Error("BROWSERBASE_API_KEY is not set");
  }
  if (!process.env.BROWSERBASE_PROJECT_ID) {
    throw new Error("BROWSERBASE_PROJECT_ID is not set");
  }
};

validateEnvironment();

const browserbase = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY,
});

export async function POST(req: Request) {
  let sessionId: string | undefined;
  try {
    const body = await req.json();

    if (!body.goal) {
      return NextResponse.json(
        { error: "Missing required field: goal" },
        { status: 400 }
      );
    }

    // Get the closest browser region based on the server's timezone
    const region = getClosestRegion(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );

    // Create a new Browserbase session
    const session = await browserbase.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      keepAlive: true,
      proxies: false,
      region,
      browserSettings: {
        viewport: {
          width: 1024,
          height: 768,
        },
        blockAds: true,
      },
      timeout: 3600,
    });

    const computer = new BrowserbaseBrowser(1024, 768, session.id);

    // Set the last argument to true to enable more verbose logging
    const agent = new Agent("computer-use-preview", computer, false);

    // Start the agent loop in the background
    const result = await runAgentLoop(
      computer,
      agent,
      body.goal,
      session.id,
      undefined,
      undefined,
      undefined
    );

    return NextResponse.json({ result });
  } catch (error) {
    console.error("Error handling demo request:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  } finally {
    if (sessionId) {
      await browserbase.sessions.update(sessionId, {
        status: "REQUEST_RELEASE",
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
      });
    }
  }
}
