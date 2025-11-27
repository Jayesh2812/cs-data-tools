import contentstack, {
  Region,
  type StackConfig,
} from "@contentstack/delivery-sdk";

import get from "lodash.get";

const REGION_CDN_URL_MAP = {
  NA: "https://cdn.contentstack.io",
  [Region.EU]: "https://eu-cdn.contentstack.com",
  [Region.AU]: "https://au-cdn.contentstack.com",
  [Region.AZURE_NA]: "https://azure-na-cdn.contentstack.com",
  [Region.AZURE_EU]: "https://azure-eu-cdn.contentstack.com",
  [Region.GCP_NA]: "https://gcp-na-cdn.contentstack.com",
  [Region.GCP_EU]: "https://gcp-eu-cdn.contentstack.com",
};

export const REGION_MANAGEMENT_URL_MAP = {
  NA: "https://api.contentstack.com/v3",
  [Region.EU]: "https://eu-api.contentstack.com/v3",
  [Region.AU]: "https://au-api.contentstack.com/v3",
  [Region.AZURE_NA]: "https://azure-na-api.contentstack.com/v3",
  [Region.AZURE_EU]: "https://azure-eu-api.contentstack.com/v3",
  [Region.GCP_NA]: "https://gcp-na-api.contentstack.com/v3",
  [Region.GCP_EU]: "https://gcp-eu-api.contentstack.com/v3",
};

export const REGION_AUTH_TOKEN_MAP = {
  NA: "https://app.contentstack.com/api/v3",
  [Region.EU]: "https://eu-app.contentstack.com/api/v3",
  [Region.AU]: "https://au-app.contentstack.com/api/v3",
  [Region.AZURE_NA]: "https://azure-na-app.contentstack.com/api/v3",
  [Region.AZURE_EU]: "https://azure-eu-app.contentstack.com/api/v3",
  [Region.GCP_NA]: "https://gcp-na-app.contentstack.com/api/v3",
  [Region.GCP_EU]: "https://gcp-eu-app.contentstack.com/api/v3",
};

// Helper function to process a single locale for a content type
const processLocaleForContentType = async (
  stack: any,
  contentType: any,
  locale: any,
  paths: string[]
): Promise<Set<string>> => {
  const localeAffectedEntries = new Set<string>();
  
  // Create a new stack instance for this locale to avoid conflicts
  const localeStack = contentstack.stack(stack.stackConfig);
  localeStack.setLocale(locale.code);

  const query = getQuery(paths);
  let {entries, count} = (
    await localeStack.contentType(contentType.uid).entry().includeCount().find()
  ) as {entries: any[], count: number};


  // Add skip limit to fetch all entries based on count
  // contentstack Delivery API limits: max 100 per request
  let skip = entries.length;
  const limit = 100;
  // Adjust query for first batch
  while (skip < count) {
    const batchQuery = { skip, limit };
    const { entries: batchEntries } = (await localeStack
      .contentType(contentType.uid)
      .entry()
      .query(batchQuery)
      .find()) as { entries: any[] };
    entries.push(...batchEntries);
    skip += limit;
  }


  for (const entry of entries) {
    if (entry.locale !== locale.code) {
      continue;
      // console.log(entry.uid, "Expected" ,locale.code, "Actual", entry.locale);
    }
    const absolutePaths = getAllAbsoluteJsonRtePaths(
      contentType.schema,
      entry
    );
    const nullPaths = absolutePaths.filter((path) => !get(entry, path));
    if (nullPaths.length) {
      localeAffectedEntries.add(
        `${entry.uid} - ${contentType.uid} - ${entry.locale} - ${entry._version}`
      );
    }
  }

  return localeAffectedEntries;
};

export const getCDANullEntries = async (
  region: Region,
  accessToken: string,
  branchName: string,
  environment: string,
  apiKey: string,
  setMessage: (message: string) => void
) => {
  const stackConfig: StackConfig = {
    accessToken,
    branch: branchName,
    environment,
    apiKey,
    deliveryToken: accessToken,
  };

  if (region) {
    stackConfig.region = region;
  }

  const stack = contentstack.stack(stackConfig);
  // Store stack config for creating new instances
  (stack as any).stackConfig = stackConfig;

  let contentTypes = (
    await stack.contentType().includeGlobalFieldSchema().find()
  ).content_types as any[];
  let locales = await getLocales(region, branchName, accessToken, apiKey);

  // contentTypes = contentTypes.filter(
  //   (contentType) => contentType.uid === "insight"
  // );
  // locales = locales.filter((locale) => locale.code === "nl-nl");

  let affectedEntriesSet = new Set<string>();

  if (!contentTypes || !locales) {
    return {
      success: false,
      message: "Content types or locales not found",
    };
  }

  for (const contentType of contentTypes) {
    setMessage(`Processing contentType: ${contentType.uid}`);
    const paths = getAllRtePaths(contentType.schema);
    
    // Create promises for all locales for this content type
    const localePromises = locales.map((locale: any) => {
      setMessage(
        `Processing locale ${locale.code} of contentType ${contentType.uid}`
      );
      return processLocaleForContentType(stack, contentType, locale, paths);
    });

    // Wait for all locale promises to settle
    const settledResults = await Promise.allSettled(localePromises);
    
    // Extract successful results and merge into main set
    settledResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        result.value.forEach((entry: string) => affectedEntriesSet.add(entry));
      } else {
        console.error(`Failed to process locale ${locales[index].code} for content type ${contentType.uid}:`, result.reason);
      }
    });
  }

  setMessage("Entries fetched successfully, total entries: " + affectedEntriesSet.size);
  return {
    success: true,
    message: "Entries fetched successfully, total entries: " + affectedEntriesSet.size,
    affectedEntriesSet,
  };
};

export async function getLocales(
  region: Region,
  branch: string,
  access_token: string,
  api_key: string
) {
  const API_URL =
    REGION_CDN_URL_MAP[(region as keyof typeof REGION_CDN_URL_MAP) || "NA"];
  const url = `${API_URL}/v3/locales`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      access_token,
      api_key,
      branch,
    },
  });
  return response.json().then((locales) => locales.locales);
}

function getAllRtePaths(schema: any, parentPath = ""): string[] {
  const paths = [];
  for (const field of schema) {
    const fieldUid = field.uid;

    const isRte = field.field_metadata?.allow_json_rte;
    const isGroupOrGlobal = ["group", "global_field"].includes(field.data_type);
    const isModularBlocks = field.data_type === "blocks";

    if (isRte) {
      paths.push(getFieldPath(parentPath, fieldUid));
    } else if (isGroupOrGlobal) {
      paths.push(
        ...getAllRtePaths(field.schema, getFieldPath(parentPath, fieldUid))
      );
    } else if (isModularBlocks) {
      const blockSchemaMap = Object.fromEntries(
        field.blocks.map((block: any) => [block.uid, block.schema])
      );
      for (const block of field.blocks) {
        if (block.uid)
          paths.push(
            ...getAllRtePaths(
              blockSchemaMap[block.uid],
              [parentPath, fieldUid, block.uid].filter((i) => i).join(".")
            )
          );
      }
    }
  }
  return paths;
}

function getFieldPath(parentPath: string, fieldUid: string, index = "") {
  const pathArray = [];

  if (parentPath) pathArray.push(parentPath);
  pathArray.push(fieldUid);
  if (index) pathArray.push(index);

  return pathArray.join(".");
}

const getQuery = (paths: string[]) => {
  const pathQuery = paths.map((path) => {
    return {
      $and: [
        { [path]: { $exists: true } },
        { [path + ".uid"]: { $exists: false } },
      ],
    };
  });

  return {
    $or: [...pathQuery],
  };
};

export function getAllAbsoluteJsonRtePaths(
  schema: any[],
  entry: any,
  parentPath = ""
): string[] {
  const paths: string[] = [];
  if (!schema || !entry) return paths;
  for (const field of schema) {
    const fieldUid = field.uid;
    const fieldValue = entry[fieldUid];

    const isMultiple = field.multiple;
    const isJsonRte =
      field.data_type === "json" && field.field_metadata?.allow_json_rte;
    const isGroupOrGlobal = ["group", "global_field"].includes(field.data_type);
    const isModularBlocks = field.data_type === "blocks";
    let index;

    if (!fieldValue && !isJsonRte) continue;

    if (isJsonRte) {
      if (isMultiple) {
        for (index of Object.keys(fieldValue)) {
          paths.push(getFieldPath(parentPath, fieldUid, index));
        }
      } else {
        paths.push(getFieldPath(parentPath, fieldUid, index));
      }
    } else if (isGroupOrGlobal) {
      if (isMultiple) {
        for (index of Object.keys(fieldValue)) {
          paths.push(
            ...getAllAbsoluteJsonRtePaths(
              field.schema,
              fieldValue[index],
              getFieldPath(parentPath, fieldUid, index)
            )
          );
        }
      } else {
        paths.push(
          ...getAllAbsoluteJsonRtePaths(
            field.schema,
            fieldValue,
            getFieldPath(parentPath, fieldUid, index)
          )
        );
      }
    } else if (isModularBlocks) {
      const blockSchemaMap = Object.fromEntries(
        field.blocks.map((block: any) => [block.uid, block.schema])
      );
      for (index of Object.keys(fieldValue)) {
        const block = fieldValue[index];
        const [block_uid] = Object.keys(block);
        if (block_uid)
          paths.push(
            ...getAllAbsoluteJsonRtePaths(
              blockSchemaMap[block_uid],
              fieldValue[index][block_uid],
              [parentPath, fieldUid, index, block_uid]
                .filter((i) => i)
                .join(".")
            )
          );
      }
    }
  }
  return paths;
}
