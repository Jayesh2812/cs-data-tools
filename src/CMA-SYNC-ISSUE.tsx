import { Region } from "@contentstack/delivery-sdk";
import { Table } from "antd";
import { Button, Input, Select } from "antd";
import { useEffect, useState } from "react";
import * as contentstack from "@contentstack/management";
import get from "lodash.get";
import isEqual from "lodash.isequal";
import { getAllAbsoluteJsonRtePaths, REGION_AUTH_TOKEN_MAP, REGION_MANAGEMENT_URL_MAP } from "./utils";

function CmaSyncIssue() {
  const [region, setRegion] = useState<Region | "">("");
  const [managementToken, setManagementToken] = useState("");
  const [branchName, setBranchName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    const configuration = localStorage.getItem("cma-sync-issue-configuration");
    if(configuration) {
      const { region, managementToken, branchName, apiKey } = JSON.parse(configuration);
      setRegion(region);
      setManagementToken(managementToken);
      setBranchName(branchName);
      setApiKey(apiKey);
    }
  }, []);

  const saveValuesToLocalStorage = () => {
    localStorage.setItem("cma-sync-issue-configuration", JSON.stringify({
      region,
      managementToken,
      branchName,
      apiKey,
    }));
  }

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
    }
  ];

  const getEntries = async () => {

    try {
      saveValuesToLocalStorage()
    const options: Record<string, string> = {}
    if( managementToken.startsWith("blt")) {
      options.authtoken = managementToken;
      options.endpoint = REGION_AUTH_TOKEN_MAP[(region as keyof typeof REGION_AUTH_TOKEN_MAP) || "NA"];
    }
    else {
      options.authorization = managementToken;
      options.endpoint = REGION_MANAGEMENT_URL_MAP[(region as keyof typeof REGION_MANAGEMENT_URL_MAP) || "NA"];
    }


    setLoading(true);
    const stack = contentstack
      .client(options)
      .stack({ api_key: apiKey });

    const ctPromise = stack
      .contentType()
      .query({ include_global_field_schema: true })
      .find();

    const localePromise = stack.locale().query({}).find();

    const [cts, locales] = await Promise.all([ctPromise, localePromise]);
    for (const ct of cts.items) {
      const entries = (await Promise.all(
        locales.items.map((locale: any) =>
          stack
            .contentType(ct.uid)
            .entry()
            .query({ locale: locale.code })
            .find().then((e) => e.items).then((e) =>{

              return e.filter( entry => entry.locale === locale.code)

            })
        )
      )).flat();

      console.log("Entries count", ct.uid, entries.length);

      const entriesWithVersionPromises = entries.map(e => {
        return stack.contentType(ct.uid).entry(e.uid).fetch({ version: e._version , locale: e.locale})
      })

      const entriesWithVersions = (await Promise.allSettled(entriesWithVersionPromises)).map(e => e.status === "fulfilled" ? e.value : null);


      for( let i = 0; i < entriesWithVersions.length; i++ ){
        setMessage(`Processing entry ${entries[i].uid} of contentType ${ct.title}`);

        const entryWOVersion = entries[i];
        const entryWVersion = entriesWithVersions[i];
        if( !entryWVersion ){
          continue;
        }
        const paths = getAllAbsoluteJsonRtePaths(ct.schema, entryWVersion);

        let affectedPaths = [];

        for ( const path of paths ){
            const valueWOVersion = get(entryWOVersion, path);
            const valueWVersion = get(entryWVersion, path);

            if(valueWOVersion === null){
              continue;
            }

            const isValueChanged = !isEqual(valueWOVersion?.children ?? [], valueWVersion?.children ?? []);

            if( isValueChanged ){
                console.log("🚀 ~ getEntries ~ path:", path, isValueChanged, entryWVersion.uid, entryWVersion.locale)
                affectedPaths.push(path);
            }
        }

        if( affectedPaths.length){
            setEntries(prev => [...prev, {
                entryId: entryWVersion.uid,
                ctId: ct.uid,
                locale: entryWVersion.locale,
                paths: affectedPaths.join(" "),
            }]);
        }
      }
    }

    setLoading(false);
    setMessage("")
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
        return columns.map(column => entry[column.dataIndex]).join("\t");
      })
      .join("\n");

    csv = columns.map(column => column.title).join("\t") + "\n" + csv;
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
      <h1>Get Entries with Sync Issue in CDA</h1>

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

export default CmaSyncIssue;
