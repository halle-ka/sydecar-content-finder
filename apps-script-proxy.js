/**
 * ============================================================================
 * Google Apps Script — Proxy for triggering the GitHub Actions workflow
 * ============================================================================
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire file into the editor (replace any existing code)
 * 3. Add your secrets:
 *    - Click the gear icon (Project Settings) in the left sidebar
 *    - Scroll to "Script Properties" and click "Add script property"
 *    - Add: GITHUB_TOKEN = your GitHub Personal Access Token
 *      (create one at https://github.com/settings/tokens with "repo" scope)
 *    - Add: GITHUB_REPO = halle-hka/sydecar-content-finder
 * 4. Deploy:
 *    - Click "Deploy" > "New deployment"
 *    - Type: "Web app"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone" (this is safe — it can only trigger the workflow)
 *    - Click "Deploy" and copy the URL
 * 5. Paste the URL into two places:
 *    - add.html: set PROXY_URL = "your-url-here"
 *    - index.html: set APPS_SCRIPT_URL = "your-url-here" (for the in-app form)
 *    - Commit and push both changes
 *
 * ============================================================================
 */

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("GITHUB_TOKEN");
  var repo = props.getProperty("GITHUB_REPO") || "halle-hka/sydecar-content-finder";

  if (!token) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: "GITHUB_TOKEN not configured" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: "Invalid JSON" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var url = payload.url || "";
  var title = payload.title || "";

  if (!url) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: "URL is required" })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // Trigger the GitHub Actions workflow
  var githubUrl = "https://api.github.com/repos/" + repo + "/actions/workflows/add-asset.yml/dispatches";

  var response = UrlFetchApp.fetch(githubUrl, {
    method: "post",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      ref: "main",
      inputs: {
        url: url,
        title: title
      }
    }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();

  if (code === 204) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, message: "Workflow triggered" })
    ).setMimeType(ContentService.MimeType.JSON);
  } else {
    return ContentService.createTextOutput(
      JSON.stringify({ error: "GitHub API returned " + code, body: response.getContentText() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Required for CORS preflight (though no-cors mode doesn't need it)
function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: "ok", message: "Use POST to add an asset" })
  ).setMimeType(ContentService.MimeType.JSON);
}
