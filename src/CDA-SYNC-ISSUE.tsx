import { Table } from "antd";
import { Button, Input, Select } from "antd";
import { useEffect, useState } from "react";
import * as contentstack from "@contentstack/management";
import get from "lodash.get";
import isEqual from "lodash.isequal";
import {
  getAllAbsoluteJsonRtePaths,
  getLocales,
  REGION_AUTH_TOKEN_MAP,
  REGION_MANAGEMENT_URL_MAP,
} from "./utils";
import contentstackDelivery, {
  Region,
  type StackConfig,
} from "@contentstack/delivery-sdk";

function CdaSyncIssue() {
  const [region, setRegion] = useState<Region | "">("");
  const [managementToken, setManagementToken] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [environment, setEnvironment] = useState("");
  const [branchName, setBranchName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    const configuration = localStorage.getItem("cda-sync-issue-configuration");
    if (configuration) {
      const {
        region,
        managementToken,
        branchName,
        apiKey,
        accessToken,
        environment,
      } = JSON.parse(configuration);
      setRegion(region);
      setManagementToken(managementToken);
      setEnvironment(environment);
      setBranchName(branchName);
      setApiKey(apiKey);
      setAccessToken(accessToken);
    }
  }, []);

  const saveValuesToLocalStorage = () => {
    localStorage.setItem(
      "cda-sync-issue-configuration",
      JSON.stringify({
        region,
        managementToken,
        branchName,
        apiKey,
        accessToken,
        environment,
      })
    );
  };

  const columns = [
    {
      title: "Entry ID",
      dataIndex: "entryId",
    },
    {
      title: "Content Type ID",
      dataIndex: "ctId",
    },
    {
      title: "Locale",
      dataIndex: "locale",
    },
    {
      title: "Paths",
      dataIndex: "paths",
    },
  ];

  const getEntries = async () => {
    try {
      saveValuesToLocalStorage();
      const options: Record<string, string> = {};
      if (managementToken.startsWith("blt")) {
        options.authtoken = managementToken;
        options.endpoint =
          REGION_AUTH_TOKEN_MAP[
            (region as keyof typeof REGION_AUTH_TOKEN_MAP) || "NA"
          ];
      } else {
        options.authorization = managementToken;
        options.endpoint =
          REGION_MANAGEMENT_URL_MAP[
            (region as keyof typeof REGION_MANAGEMENT_URL_MAP) || "NA"
          ];
      }

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

      const deliveryStack = contentstackDelivery.stack(stackConfig);
      // Store stack config for creating new instances
      (deliveryStack as any).stackConfig = stackConfig;

      setLoading(true);
      const stack = contentstack.client(options).stack({ api_key: apiKey });

      let contentTypes = (
        await deliveryStack.contentType().includeGlobalFieldSchema().find()
      ).content_types as any[];
      let locales = await getLocales(
        region as Region,
        branchName,
        accessToken,
        apiKey
      );

      for (const ct of contentTypes) {
        for (let locale of locales) {
          deliveryStack.setLocale(locale.code);

          let { entries, count } = (await deliveryStack
            .contentType(ct.uid)
            .entry()
            .includeCount()
            .find()) as { entries: any[]; count: number };

          // Add skip limit to fetch all entries based on count
          // contentstack Delivery API limits: max 100 per request
          let skip = entries.length;
          const limit = 100;
          // Adjust query for first batch
          while (skip < count) {
            const batchQuery = { skip, limit };
            const { entries: batchEntries } = (await deliveryStack
              .contentType(ct.uid)
              .entry()
              .query(batchQuery)
              .find()) as { entries: any[] };
            entries.push(...batchEntries);
            skip += limit;
          }
          console.log("Entries count", ct.uid, entries.length);

          
        const CMAEntries = (await Promise.allSettled(entries.map(async (e) => {
            return stack.contentType(ct.uid).entry(e.uid).fetch({ locale: e.locale });
        }))).map(e => e.status === "fulfilled" ? e.value : null);

        for( let i = 0; i < entries.length; i++ ){
            const CDAEntry = entries[i];
            const CMAEntry = CMAEntries[i];
            if( !CMAEntry ){
                continue;
            }
            if( CDAEntry._version !== CMAEntry._version ){
                continue;
            }

            const paths = getAllAbsoluteJsonRtePaths(ct.schema, CDAEntry);

            let affectedPaths = [];

            for (const path of paths) {
              const valueWOVersion = get(CDAEntry, path);
              const valueWVersion = get(CMAEntry, path);

              if (valueWOVersion === null) {
                continue;
              }

              const isValueChanged = !isEqual(
                valueWOVersion?.children ?? [],
                valueWVersion?.children ?? []
              );

              if (isValueChanged) {
                console.log(
                  "🚀 ~ getEntries ~ path:",
                  path,
                  isValueChanged,
                  CDAEntry.uid,
                  CDAEntry.locale
                );
                affectedPaths.push(path);
              }
            }

            if (affectedPaths.length) {
              setEntries((prev) => [
                ...prev,
                {
                  entryId: CDAEntry.uid,
                  ctId: ct.uid,
                  locale: CDAEntry.locale,
                  paths: affectedPaths.join(" "),
                },
              ]);
            }
          }
        }
      }

      setLoading(false);
      setMessage("");
    } catch (error) {
      setMessage(`Error: ${error}`);
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const downloadEntriesAsCSV = () => {
    let csv = entries
      .map((entry) => {
        return columns.map((column) => entry[column.dataIndex]).join("\t");
      })
      .join("\n");

    csv = columns.map((column) => column.title).join("\t") + "\n" + csv;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "affected_entries.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <h1>Get Entries with Sync Issue in CDA and CMA</h1>

      <div style={{ display: "flex", gap: "10px" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <label>Region</label>
          <Select
            value={region}
            onChange={(e) => setRegion(e as Region)}
            options={[
              { value: "", label: "AWS NA" },
              { value: Region.EU, label: "AWS EU" },
              { value: Region.AU, label: "AWS AU" },
              { value: Region.AZURE_NA, label: "AZURE NA" },
              { value: Region.AZURE_EU, label: "AZURE EU" },
              { value: Region.GCP_NA, label: "GCP NA" },
              { value: Region.GCP_EU, label: "GCP EU" },
            ]}
          />
        </div>
        <div>
          <label>API Key</label>
          <Input
            type="text"
            placeholder="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div>
          <label>Management Token / Authtoken</label>
          <Input
            type="text"
            placeholder="Management Token / Authtoken"
            value={managementToken}
            onChange={(e) => setManagementToken(e.target.value)}
          />
        </div>
        <div>
          <label>Branch name</label>
          <Input
            type="text"
            placeholder="Branch name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
          />
        </div>
        <div>
          <label>Access Token</label>
          <Input
            type="text"
            placeholder="Access Token"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
          />
        </div>
        <div>
          <label>Environment</label>
          <Input
            type="text"
            placeholder="Environment"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
          />
        </div>
      </div>

      <div
        style={{
          margin: "20px auto",
          width: "fit-content",
          display: "flex",
          gap: "10px",
        }}
      >
        <Button type="primary" onClick={getEntries} loading={loading}>
          Get affected entries
        </Button>

        <Button onClick={downloadEntriesAsCSV}>Download entries as CSV</Button>
      </div>
      {message && <h5>{message}</h5>}
      <Table dataSource={entries} loading={loading} columns={columns} />
    </>
  );
}

export default CdaSyncIssue;
