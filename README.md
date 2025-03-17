# Slack Operator

A simple Computer Use Agent connected to Slack and powered by [Browserbase](https://browserbase.com/computer-use). 

## How it Works

Slack Operator is an Computer-Use Agent that can perform web-based tasks through natural language commands in Slack. Here's how the system works:

1. **Browser Control**: The agent uses Browserbase to control a real browser instance, allowing it to interact with websites just like a human would.

2. **Integration Points**:
   - **Slack Integration**: When deployed, the bot listens for mentions in Slack channels and responds to user requests in threads
   - **Demo API**: A simplified endpoint (`/api/demo`) for testing the functionality without Slack integration

3. **Agent Loop**:
   - The agent receives a goal (either from Slack or the demo API)
   - It analyzes the request and determines the appropriate starting point (usually a relevant website)
   - Through an iterative process, it:
     - Navigates websites
     - Interacts with web elements
     - Extracts information
     - Reports progress back to the user
   - When deployed to Vercel, the agent maintains state between interactions, allowing for follow-up questions and multi-step tasks

4. **State Management**:
   - For Slack interactions, the agent maintains conversation state to support continuous interactions
   - Each session uses a dedicated browser instance that persists throughout the task

5. **Regional Optimization**:
   - The system automatically selects the closest browser region based on the server's timezone for optimal performance

## Setup

### 1. Deploy to Vercel
1. Click the "Deploy with Vercel" button above
2. Create a new project on Vercel and import this repository
3. You'll set the environment variables later in step 4

### 2. Create Slack App
1. Go to https://api.slack.com/apps and click "Create New App"
2. Choose "From an app manifest"
3. Select your workspace and paste the contents of `slack-manifest.json`
4. Replace `https://your-vercel-deployment-url` in the manifest with your actual Vercel deployment URL
5. Review and create the app

### 3. Install App to Workspace
1. Go to "Install App" in the sidebar
2. Click "Install to Workspace" and authorize the app

### 4. Configure Environment Variables
1. Go to your Slack App's "Basic Information" page and copy the "Signing Secret"
2. Go to "OAuth & Permissions" and copy the "Bot User OAuth Token"
3. In your Vercel project settings, add these environment variables:
   - `SLACK_BOT_TOKEN`: Your Bot User OAuth Token (starts with xoxb-)
   - `SLACK_SIGNING_SECRET`: Your Signing Secret
   - `SLACK_BOT_ID`: Your Bot User ID (starts with U)
   - `BROWSERBASE_API_KEY`: Your Browserbase API Key
   - `BROWSERBASE_PROJECT_ID`: Your Browserbase Project ID
   - `OPENAI_API_KEY`: Your OpenAI API Key
4. Redeploy your Vercel project for the changes to take effect

## Running locally (without Slack)

You can test the functionality directly using the demo API endpoint without setting up Slack integration:

1. Clone this repository

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.local` and add your API keys:
   ```
   BROWSERBASE_API_KEY=your-browserbase-api-key
   BROWSERBASE_PROJECT_ID=your-browserbase-project-id
   OPENAI_API_KEY=your-openai-api-key
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Send a POST request to `/api/demo` with your goal:
   ```bash
   curl -X POST http://localhost:3000/api/demo \
     -H "Content-Type: application/json" \
     -d '{"goal": "What is the weather in San Francisco?"}'
   ```

Note: The demo endpoint does not support follow up questions with the agent. The requires persistent state to be saved between steps.
