import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

const app = express();

const PORT = Number(process.env.PORT || 8787);
const APP_URL = process.env.APP_URL || "http://localhost:5173";
const JOBBER_CLIENT_ID = process.env.JOBBER_CLIENT_ID || "";
const JOBBER_CLIENT_SECRET = process.env.JOBBER_CLIENT_SECRET || "";
const JOBBER_REDIRECT_URI = process.env.JOBBER_REDIRECT_URI || "http://localhost:8787/api/jobber/callback";
const JOBBER_API_VERSION = process.env.JOBBER_API_VERSION || "2025-01-20";

const AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const tokenFilePath = path.resolve(process.cwd(), "server", ".jobber-tokens.json");

app.use(express.json({ limit: "10mb" }));

function isConfigured() {
  return Boolean(JOBBER_CLIENT_ID && JOBBER_CLIENT_SECRET && JOBBER_REDIRECT_URI);
}

async function readTokens() {
  try {
    const raw = await fs.readFile(tokenFilePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeTokens(tokens) {
  await fs.mkdir(path.dirname(tokenFilePath), { recursive: true });
  await fs.writeFile(tokenFilePath, JSON.stringify(tokens, null, 2), "utf8");
}

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeState(value) {
  try {
    return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function createAppRedirect(status, detail = "") {
  const url = new URL(APP_URL);
  url.searchParams.set("jobber", status);

  if (detail) {
    url.searchParams.set("jobber_detail", detail);
  }

  return url.toString();
}

async function exchangeToken(params) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams(params)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Jobber token exchange failed.");
  }

  return payload;
}

async function refreshAccessToken(tokens) {
  if (!tokens?.refresh_token) {
    throw new Error("Jobber refresh token is missing. Reconnect the app.");
  }

  const payload = await exchangeToken({
    client_id: JOBBER_CLIENT_ID,
    client_secret: JOBBER_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token
  });

  const refreshed = {
    ...tokens,
    ...payload,
    refreshedAt: new Date().toISOString()
  };

  await writeTokens(refreshed);
  return refreshed;
}

async function graphqlRequest({ accessToken, query, variables = {} }) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": JOBBER_API_VERSION
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function jobberRequest(query, variables = {}) {
  let tokens = await readTokens();

  if (!tokens?.access_token) {
    throw new Error("Jobber is not connected yet.");
  }

  let { response, payload } = await graphqlRequest({
    accessToken: tokens.access_token,
    query,
    variables
  });

  if (response.status === 401 && tokens.refresh_token) {
    tokens = await refreshAccessToken(tokens);
    ({ response, payload } = await graphqlRequest({
      accessToken: tokens.access_token,
      query,
      variables
    }));
  }

  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.message || "Jobber request failed.");
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || "Jobber GraphQL error.");
  }

  return payload.data;
}

function formatAddress(address) {
  if (!address) return { address: "", city: "" };

  const street = [address.street1, address.street2].filter(Boolean).join(" ").trim();
  const city = address.city || "";
  const region = address.province || "";
  const postal = address.postalCode || "";

  return {
    address: [street, city, region, postal].filter(Boolean).join(", "),
    city
  };
}

function normalizeClient(node) {
  const propertyAddress = node.clientProperties?.nodes?.[0]?.address;
  const billingAddress = node.billingAddress;
  const resolvedAddress = propertyAddress || billingAddress;
  const formatted = formatAddress(resolvedAddress);

  return {
    id: node.id,
    name: node.name || [node.firstName, node.lastName].filter(Boolean).join(" ").trim(),
    phone: node.phones?.[0]?.number || "",
    email: node.emails?.[0]?.address || "",
    address: formatted.address,
    city: formatted.city
  };
}

const clientsQueryWithProperties = `
  query HoneyDoneClients($first: Int!, $after: String) {
    clients(first: $first, after: $after) {
      nodes {
        id
        name
        firstName
        lastName
        isArchived
        emails {
          address
        }
        phones {
          number
        }
        billingAddress {
          street1
          street2
          city
          province
          postalCode
        }
        clientProperties(first: 1) {
          nodes {
            address {
              street1
              street2
              city
              province
              postalCode
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
      totalCount
    }
  }
`;

const clientsQueryBasic = `
  query HoneyDoneClientsBasic($first: Int!, $after: String) {
    clients(first: $first, after: $after) {
      nodes {
        id
        name
        firstName
        lastName
        isArchived
        emails {
          address
        }
        phones {
          number
        }
        billingAddress {
          street1
          street2
          city
          province
          postalCode
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
      totalCount
    }
  }
`;

const accountQuery = `
  query HoneyDoneAccount {
    account {
      id
      name
    }
  }
`;

async function fetchAllClients(query) {
  const clients = [];
  let after = null;
  let totalCount = 0;

  do {
    const data = await jobberRequest(query, { first: 100, after });
    const connection = data.clients;
    totalCount = connection.totalCount || totalCount;

    for (const node of connection.nodes || []) {
      if (!node.isArchived) {
        clients.push(normalizeClient(node));
      }
    }

    after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);

  return { clients, totalCount };
}

app.get("/api/jobber/status", async (_req, res) => {
  const tokens = await readTokens();

  res.json({
    configured: isConfigured(),
    connected: Boolean(tokens?.access_token || tokens?.refresh_token),
    accountName: tokens?.accountName || "",
    accountId: tokens?.accountId || "",
    connectUrl: "/api/jobber/connect"
  });
});

app.get("/api/jobber/connect", (req, res) => {
  if (!isConfigured()) {
    res.redirect(createAppRedirect("missing_config", "Add Jobber credentials to .env first."));
    return;
  }

  const state = encodeState({
    returnTo: req.query.returnTo || APP_URL,
    startedAt: Date.now()
  });

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", JOBBER_CLIENT_ID);
  url.searchParams.set("redirect_uri", JOBBER_REDIRECT_URI);
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

app.get("/api/jobber/callback", async (req, res) => {
  const state = decodeState(req.query.state);
  const returnTo = state.returnTo || APP_URL;

  if (req.query.error) {
    res.redirect(createAppRedirect("error", String(req.query.error_description || req.query.error)));
    return;
  }

  try {
    const payload = await exchangeToken({
      client_id: JOBBER_CLIENT_ID,
      client_secret: JOBBER_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: String(req.query.code || ""),
      redirect_uri: JOBBER_REDIRECT_URI
    });

    const tokens = {
      ...payload,
      createdAt: new Date().toISOString()
    };

    await writeTokens(tokens);

    try {
      const account = await jobberRequest(accountQuery);
      await writeTokens({
        ...(await readTokens()),
        accountId: account.account?.id || "",
        accountName: account.account?.name || ""
      });
    } catch {
      // The token is still useful even if account lookup is unavailable.
    }

    const redirectUrl = new URL(returnTo);
    redirectUrl.searchParams.set("jobber", "connected");
    res.redirect(redirectUrl.toString());
  } catch (error) {
    res.redirect(createAppRedirect("error", error.message || "Jobber authorization failed."));
  }
});

app.get("/api/jobber/clients", async (_req, res) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({
        success: false,
        error: "Jobber is not configured. Add JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET, and JOBBER_REDIRECT_URI to .env."
      });
      return;
    }

    let result;

    try {
      result = await fetchAllClients(clientsQueryWithProperties);
    } catch (error) {
      result = await fetchAllClients(clientsQueryBasic);
      result.fallbackReason = error.message || "Property-aware query failed.";
    }

    res.json({
      success: true,
      clients: result.clients,
      totalCount: result.totalCount,
      source: "jobber",
      fallbackReason: result.fallbackReason || ""
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Jobber client sync failed."
    });
  }
});

app.listen(PORT, () => {
  console.log(`HoneyDone Jobber bridge listening on http://localhost:${PORT}`);
});
