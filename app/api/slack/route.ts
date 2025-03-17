import { WebClient } from "@slack/web-api";
import { NextResponse } from "next/server";
import { Browserbase } from "@browserbasehq/sdk";
import { getState, runAgentLoop } from "./operator";
import { waitUntil } from '@vercel/functions';
import { BrowserbaseBrowser } from "../agent/browserbase";
import { Agent } from "../agent/agent";

// Set the default to 60 seconds. This is not enough!
// Once you enable Fluid Compute, you can can set this to 800 seconds.
export const maxDuration: number = 60;

// Initialize clients
const validateEnvironment = () => {
  if (!process.env.BROWSERBASE_API_KEY) {
    throw new Error("BROWSERBASE_API_KEY is not set");
  }
  if (!process.env.BROWSERBASE_PROJECT_ID) {
    throw new Error("BROWSERBASE_PROJECT_ID is not set");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
};

validateEnvironment();

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const browserbase = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY,
});

const handleUrlVerification = (body: any) => {
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }
  return null;
};

const createSession = async (channel: string, ts: string, userId: string, goal: string) => {
  const session = await browserbase.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    keepAlive: true,
    proxies: false,
    browserSettings: {
      viewport: {
        width: 1024,
        height: 768,
      },
      blockAds: true,
    },
    userMetadata: {
      slackChannel: channel,
      messageTs: ts?.replace(/[^\w\s-]/g, ""),
      userId: userId,
    },
    timeout: 3600,
  });

  const computer = new BrowserbaseBrowser(
    1024,
    768,
    session.id,
    "us-west-2",
    false,
  );
  const agent = new Agent("computer-use-preview", computer, false);

  if (maxDuration === 60) {
    await slack.chat.postMessage({
      channel: channel,
      text: `⚠️  The default timeout is 60 seconds. Please enable Fluid Compute and update the timeout in slack/route.ts to 800 seconds.`,
      thread_ts: ts,
    });
  }
  
  await runAgentLoop(computer, agent, goal, session.id, slack, channel, ts);
};

const handleNewMessage = async (event: any) => {
  if (
    !event.thread_ts &&
    !event.bot_id &&
    event.user !== process.env.SLACK_BOT_USER_ID &&
    event.text.includes(`<@${process.env.SLACK_BOT_USER_ID}>`)
  ) {
    // Check for existing sessions
    const query = `user_metadata['messageTs']:'${event.ts?.replace(/[^\w\s-]/g, "")}'`;
    const existingSessions = await browserbase.sessions.list({ q: query });

    if (existingSessions.length > 0) {
      console.log("Found existing session:", existingSessions[0].id);
      return;
    }

    const goal = event.text
      .replace(`<@${process.env.SLACK_BOT_USER_ID}>`, "")
      .trim();

    await createSession(event.channel, event.ts, event.user, goal);
  }
};

const handleThreadReply = async (event: any) => {
  if (!event.thread_ts || event.bot_id || event.user === process.env.SLACK_BOT_USER_ID) {
    return;
  }

  const query = `user_metadata['messageTs']:'${event.thread_ts?.replace(/[^\w\s-]/g, "")}'`;
  const sessions = await browserbase.sessions.list({ q: query });

  if (sessions.length === 0) return;

  const session = sessions[0];

  if (event.text.toLowerCase().includes('stop')) {
    await browserbase.sessions.update(session.id, {
      status: "REQUEST_RELEASE",
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
    });
    await slack.chat.postMessage({
      channel: event.channel,
      text: `Browser session stopped successfully.`,
      thread_ts: event.thread_ts,
    });
    return;
  }

  const savedState = await getState(session.id);
  if (savedState) {
    await slack.chat.postMessage({
      channel: event.channel,
      text: `👍 Got your response! Continuing with the task...`,
      thread_ts: event.thread_ts,
    });

    const computer = new BrowserbaseBrowser(
      1024,
      768,
      session.id,
      "us-west-2",
      false,
    );
    const agent = new Agent("computer-use-preview", computer, false);

    await runAgentLoop(
      computer,
      agent,
      "",
      session.id,
      slack,
      event.channel,
      event.thread_ts,
      savedState,
      event.text
    );
  } else {
    const { debuggerUrl } = await browserbase.sessions.debug(session.id);
    await slack.chat.postMessage({
      channel: event.channel,
      text: `Found running operator session! Debug URL: ${debuggerUrl}`,
      thread_ts: event.thread_ts,
    });
  }
};

const createTimeoutPromise = (channel: string, threadTs: string) => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Processing timeout'));
    }, maxDuration * 1000 - 5000); // 5 seconds before timeout so we have time to gracefully stop the session
  }).catch(async (error) => {
    await slack.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: "⚠️ Function timed out while working. Please enable Fluid Compute and maxDuration in slack/route.ts to 800 seconds.",
    });
    throw error;
  });
};

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Handle URL verification
    const urlVerificationResponse = handleUrlVerification(body);
    if (urlVerificationResponse) return urlVerificationResponse;

    // Return immediate response for all other requests
    const response = NextResponse.json({ ok: true });

    if (body.type === "event_callback") {
      const event = body.event;

      if (event.type === "message" && !event.bot_id) {
        waitUntil(Promise.race([
          (async () => {
            try {
              await handleNewMessage(event);
              await handleThreadReply(event);
            } catch (err) {
              const error = err as Error;
              await slack.chat.postMessage({
                channel: event.channel,
                thread_ts: event.thread_ts || event.ts,
                text: "⚠️ There was an error processing your request. Please try again or check the session status.",
              });
              throw error;
            }
          })(),
          createTimeoutPromise(event.channel, event.thread_ts || event.ts)
        ]));
      }
    }

    return response;
  } catch (error) {
    console.error("Error handling Slack event:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
