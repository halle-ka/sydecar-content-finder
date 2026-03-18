/**
 * ============================================================================
 * Google Apps Script — Proxy for Content Finder
 * ============================================================================
 *
 * Handles two things:
 *   1. HubSpot deal/contact lookups (so the Private App token stays server-side)
 *   2. Triggering the GitHub Actions "add-asset" workflow
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire file into the editor (replace any existing code)
 * 3. Add your secrets via Project Settings > Script Properties:
 *    - GITHUB_TOKEN  = your GitHub Personal Access Token (repo scope)
 *    - GITHUB_REPO   = halle-hka/sydecar-content-finder
 *    - HUBSPOT_TOKEN = your HubSpot Private App token (crm.objects.contacts.read,
 *                      crm.objects.deals.read scopes)
 * 4. Deploy > New deployment > Web app > Execute as "Me" > Anyone > Deploy
 * 5. Copy the URL and set it as APPS_SCRIPT_URL in index.html
 *
 * IMPORTANT: After updating this code, you must create a NEW deployment
 * (Deploy > Manage deployments > pencil icon > Version: New version > Deploy)
 * for changes to take effect.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function hubspotFetch(path, options) {
  var token = PropertiesService.getScriptProperties().getProperty("HUBSPOT_TOKEN");
  if (!token) throw new Error("HUBSPOT_TOKEN not configured in Script Properties");

  var defaults = {
    method: "get",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  };

  for (var k in options) defaults[k] = options[k];
  if (options && options.headers) {
    defaults.headers["Authorization"] = "Bearer " + token;
    defaults.headers["Content-Type"] = "application/json";
  }

  var resp = UrlFetchApp.fetch("https://api.hubspot.com" + path, defaults);
  return JSON.parse(resp.getContentText());
}

// ---------------------------------------------------------------------------
// Deal stage mapping: HubSpot values -> Content Finder categories
// ---------------------------------------------------------------------------
var STAGE_MAP = {
  // Sales Pipeline
  "17296960": "SQL",                    // SQL
  "102737501": "SQL",                   // Lead
  "103684772": "Warm Opportunity",      // Lukewarm
  "126914314": "Warm Opportunity",      // Warm Relationship
  "45448785": "Warm Opportunity",       // 50%
  "45439091": "Warm Opportunity",       // 25%
  "45439092": "Warm Opportunity",       // 50%
  "103684773": "Hot Opportunity",       // Hot
  "45448786": "Hot Opportunity",        // 75%
  "45448787": "Hot Opportunity",        // 90%
  "45439093": "Hot Opportunity",        // 75%
  "45439094": "Hot Opportunity",        // 90%
  // Other pipeline stages
  "101994244": "SQL",                   // Appointment scheduled
  "101994245": "Warm Opportunity",      // Qualified to buy
  "101994246": "Warm Opportunity",      // Presentation scheduled
  "101994247": "Hot Opportunity",       // Decision Maker Bought-In
  "101994248": "Hot Opportunity",       // Contract sent
  "987974538": "SQL",                   // Appointment Scheduled
  "987974539": "Warm Opportunity",      // Qualified To Buy
  "987974540": "Warm Opportunity",      // Presentation Scheduled
  "987974541": "Hot Opportunity",       // Decision Maker Bought-In
  "987974542": "Hot Opportunity",       // Signed
  "988072561": "SQL",                   // Appointment Scheduled
  "988072562": "Warm Opportunity",      // Qualified To Buy
  "988072563": "Warm Opportunity",      // Presentation Scheduled
  "988072564": "Hot Opportunity",       // Decision Maker Bought-In
  "988072565": "Hot Opportunity",       // Signed
  // Deal-specific
  "134374658": "SQL",                   // Reached Out
  "134374659": "Warm Opportunity",      // NDA
  "134374660": "Warm Opportunity",      // In Dialogue
  "101950501": "Hot Opportunity",       // Term Sheet
  "101933157": "Hot Opportunity",       // Agreement
};

// ---------------------------------------------------------------------------
// Customer segment mapping: HubSpot values -> Content Finder personas
// ---------------------------------------------------------------------------
var SEGMENT_MAP = {
  "Fund Manager":               "Fund Manager",
  "Upmarket Fund Manager":      "Fund Manager",
  "Fund of Funds":              "Fund Manager",
  "Family Office":              "Fund Manager",
  "Fund CFO":                   "Fund Manager",
  "Emerging Fund Manager":      "Emerging Manager / Syndicate",
  "Syndicate Lead":             "Emerging Manager / Syndicate",
  "Hybrid Fund/Syndicate":      "Emerging Manager / Syndicate",
  "Occasional Deal Lead":       "Occasional Deal Lead",
  "Angel Group":                "Occasional Deal Lead",
  "Founder":                    "Founder",
  "Studio":                     "Founder",
  "RIA":                        "RIA",
  "Broker-Dealer":              "Broker-Dealer",
  "Attorney":                   "Other",
  "Accelerator":                "Other",
  "Enterprise":                 "Other",
  "Influencer":                 "Other",
  "Investment Community":       "Other",
  "Limited Partner":            "Other",
  "Partnership":                "Other",
  "Platform":                   "Other",
};

// ---------------------------------------------------------------------------
// Competitor mapping: HubSpot values -> Content Finder competitors
// ---------------------------------------------------------------------------
var COMPETITOR_MAP = {
  "Angel List":           "AngelList",
  "Carta":                "Carta",
  "Allocations":          "Allocations",
  "Manual/No Software":   "Manual / DIY (law firm)",
  "Aduro":                "None / not sure",
  "Canopy":               "None / not sure",
  "Odin":                 "None / not sure",
  "Finally Fund Admin":   "None / not sure",
  "Juniper Square":       "None / not sure",
  "Loon Creek":           "None / not sure",
  "Flow Inc":             "None / not sure",
  "Venture 360":          "None / not sure",
  "PropelX":              "None / not sure",
  "Sally":                "None / not sure",
  "Other":                "None / not sure",
};

// ---------------------------------------------------------------------------
// Challenge inference: map non_convert_subreason values to Content Finder challenges
// ---------------------------------------------------------------------------
var SUBREASON_TO_CHALLENGE = {
  "Cost":                              "Pricing",
  "Fee Structure":                     "Pricing",
  "Custom Docs":                       "Compliance / regulatory questions",
  "RIA":                               "Compliance / regulatory questions",
  "506c":                              "Compliance / regulatory questions",
  "Jurisdiction":                      "Compliance / regulatory questions",
  "International Passthrough":         "Compliance / regulatory questions",
  "GP/LP Structure":                   "Layered SPVs / complex structures",
  "Multi Close":                       "Layered SPVs / complex structures",
  "Take Over Existing SPVs":           "Layered SPVs / complex structures",
  "Co-Management":                     "Layered SPVs / complex structures",
  "Co-Syndication":                    "Layered SPVs / complex structures",
  "Couldn't Fundraise":                "Building a track record / LP base",
  "No Deal Ready/Lost Deal":           "Building a track record / LP base",
  "Vendor Risk":                       "Sydecar credibility / brand",
  "Wanted White Label":                "Sydecar credibility / brand",
  "Capital Calls":                     "Speed",
  "PE Investment (Frequent Distributions)": "Speed",
};

// ---------------------------------------------------------------------------
// Action: Search deals by name
// ---------------------------------------------------------------------------
function searchDeals(query) {
  var data = hubspotFetch("/crm/v3/objects/deals/search", {
    method: "post",
    payload: JSON.stringify({
      query: query,
      limit: 8,
      properties: ["dealname", "dealstage", "amount", "pipeline"]
    })
  });

  var results = (data.results || []).map(function(d) {
    var stage = STAGE_MAP[d.properties.dealstage] || "SQL";
    return {
      id: d.id,
      type: "deal",
      name: d.properties.dealname || "Untitled Deal",
      dealStage: stage,
      dealStageRaw: d.properties.dealstage,
      amount: d.properties.amount || null
    };
  });

  return results;
}

// ---------------------------------------------------------------------------
// Action: Search contacts by name or email
// ---------------------------------------------------------------------------
function searchContacts(query) {
  var data = hubspotFetch("/crm/v3/objects/contacts/search", {
    method: "post",
    payload: JSON.stringify({
      query: query,
      limit: 8,
      properties: ["firstname", "lastname", "email", "customer_segment", "company"]
    })
  });

  var results = (data.results || []).map(function(c) {
    var seg = c.properties.customer_segment || "";
    var persona = SEGMENT_MAP[seg] || "Other";
    var name = [(c.properties.firstname || ""), (c.properties.lastname || "")].join(" ").trim();
    return {
      id: c.id,
      type: "contact",
      name: name || c.properties.email || "Unknown",
      email: c.properties.email || "",
      company: c.properties.company || "",
      persona: persona,
      segmentRaw: seg
    };
  });

  return results;
}

// ---------------------------------------------------------------------------
// Action: Get full context for a deal (deal stage + associated contact segment)
// ---------------------------------------------------------------------------
function getDealContext(dealId) {
  // Get the deal with description for challenge inference
  var deal = hubspotFetch("/crm/v3/objects/deals/" + dealId + "?properties=dealname,dealstage,amount,pipeline,description&associations=contacts", {});

  var stage = STAGE_MAP[deal.properties.dealstage] || "SQL";
  var result = {
    dealId: dealId,
    dealName: deal.properties.dealname || "",
    dealStage: stage,
    dealStageRaw: deal.properties.dealstage,
    persona: null,
    segmentRaw: null,
    contactName: null,
    contactEmail: null,
    competitor: "None / not sure",
    competitorRaw: null,
    challenges: [],
    notes: deal.properties.description || ""
  };

  // Get associated contacts for segment, competitor, subreason, and notes
  var assocContacts = (deal.associations && deal.associations.contacts &&
    deal.associations.contacts.results) || [];

  if (assocContacts.length > 0) {
    var contactId = assocContacts[0].id;
    var contact = hubspotFetch("/crm/v3/objects/contacts/" + contactId + "?properties=firstname,lastname,email,customer_segment,competitor,non_convert_subreason,lead_qualification_notes", {});
    var seg = contact.properties.customer_segment || "";
    result.persona = SEGMENT_MAP[seg] || "Other";
    result.segmentRaw = seg;
    result.contactName = [(contact.properties.firstname || ""), (contact.properties.lastname || "")].join(" ").trim();
    result.contactEmail = contact.properties.email || "";

    // Competitor
    var comp = contact.properties.competitor || "";
    result.competitorRaw = comp;
    result.competitor = COMPETITOR_MAP[comp] || "None / not sure";

    // Challenges from non_convert_subreason
    var subreason = contact.properties.non_convert_subreason || "";
    if (subreason && SUBREASON_TO_CHALLENGE[subreason]) {
      result.challenges.push(SUBREASON_TO_CHALLENGE[subreason]);
    }

    // Append lead qualification notes for challenge inference
    var lqNotes = contact.properties.lead_qualification_notes || "";
    if (lqNotes) {
      result.notes = (result.notes ? result.notes + "\n\n" : "") + lqNotes;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Action: Get contact context (segment + associated deal stage)
// ---------------------------------------------------------------------------
function getContactContext(contactId) {
  var contact = hubspotFetch("/crm/v3/objects/contacts/" + contactId + "?properties=firstname,lastname,email,customer_segment,company,competitor,non_convert_subreason,lead_qualification_notes&associations=deals", {});

  var seg = contact.properties.customer_segment || "";
  var name = [(contact.properties.firstname || ""), (contact.properties.lastname || "")].join(" ").trim();

  // Competitor
  var comp = contact.properties.competitor || "";

  // Challenges from non_convert_subreason
  var challenges = [];
  var subreason = contact.properties.non_convert_subreason || "";
  if (subreason && SUBREASON_TO_CHALLENGE[subreason]) {
    challenges.push(SUBREASON_TO_CHALLENGE[subreason]);
  }

  var result = {
    contactId: contactId,
    contactName: name,
    contactEmail: contact.properties.email || "",
    company: contact.properties.company || "",
    persona: SEGMENT_MAP[seg] || "Other",
    segmentRaw: seg,
    dealStage: null,
    dealName: null,
    competitor: COMPETITOR_MAP[comp] || "None / not sure",
    competitorRaw: comp,
    challenges: challenges,
    notes: contact.properties.lead_qualification_notes || ""
  };

  // Get associated deals for deal stage and description
  var assocDeals = (contact.associations && contact.associations.deals &&
    contact.associations.deals.results) || [];

  if (assocDeals.length > 0) {
    var dealId = assocDeals[0].id;
    var deal = hubspotFetch("/crm/v3/objects/deals/" + dealId + "?properties=dealname,dealstage,description", {});
    result.dealStage = STAGE_MAP[deal.properties.dealstage] || "SQL";
    result.dealName = deal.properties.dealname || "";
    var dealDesc = deal.properties.description || "";
    if (dealDesc) {
      result.notes = (result.notes ? result.notes + "\n\n" : "") + dealDesc;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Action: Trigger GitHub Actions workflow (add-asset)
// ---------------------------------------------------------------------------
function triggerAddAsset(url, title) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("GITHUB_TOKEN");
  var repo = props.getProperty("GITHUB_REPO") || "halle-hka/sydecar-content-finder";

  if (!token) throw new Error("GITHUB_TOKEN not configured");

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
      inputs: { url: url, title: title || "" }
    }),
    muteHttpExceptions: true
  });

  return response.getResponseCode() === 204;
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || "add_asset";

    switch (action) {
      case "search":
        var query = payload.query || "";
        if (!query) return jsonResponse({ error: "query is required" });
        var deals = searchDeals(query);
        var contacts = searchContacts(query);
        return jsonResponse({ deals: deals, contacts: contacts });

      case "get_deal":
        var dealId = payload.dealId;
        if (!dealId) return jsonResponse({ error: "dealId is required" });
        return jsonResponse(getDealContext(dealId));

      case "get_contact":
        var contactId = payload.contactId;
        if (!contactId) return jsonResponse({ error: "contactId is required" });
        return jsonResponse(getContactContext(contactId));

      case "add_asset":
        var url = payload.url || "";
        if (!url) return jsonResponse({ error: "url is required" });
        var ok = triggerAddAsset(url, payload.title);
        return jsonResponse(ok ? { success: true } : { error: "GitHub API failed" });

      default:
        return jsonResponse({ error: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonResponse({ error: err.message || String(err) });
  }
}

function doGet(e) {
  return jsonResponse({ status: "ok", message: "POST with action: search | get_deal | get_contact | add_asset" });
}
