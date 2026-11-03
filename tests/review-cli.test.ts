import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createUnitManifest } from "../src/question";

const repo = resolve(import.meta.dir, "..");
test("CLI E2E: source units -> oracle -> pilot approval -> residual -> final approval -> changed bytes block", () => {
  const dir = mkdtempSync(join(process.env.PROBLEM_EDIT_TEST_TMP ?? tmpdir(), "review-e2e-"));
  try {
    const save = (name: string, value: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };
    const run = (args: string[], success = true) => {
      const r = Bun.spawnSync(["bun", "run", "src/cli.ts", "review", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
      expect(r.exitCode).toBe(success ? 0 : 1);
      if (!success) { expect(new TextDecoder().decode(r.stdout)).toBe(""); return new TextDecoder().decode(r.stderr); }
      return JSON.parse(new TextDecoder().decode(r.stdout));
    };
    const paths = [1, 2, 3].map(n => {
      const u = createUnitManifest({ sourceSha256: "a".repeat(64), questionId: `Q${n}`, physicalPage: 1, logicalOrder: n });
      u.contentRevision = `synthetic-${n}`;
      u.stages.forEach(s => { s.state = "done"; s.outputRevision = `${n}-${s.stage}`; });
      return save(`q${n}.json`, u);
    });
    const unitArgs = ["--units", paths.join(",")];
    let op = run(["new", "--operation", "synthetic-e2e", ...unitArgs, "--pilot", "Q1,Q2"]);
    let opPath = save("review-0.json", op), serial = 0;
    const persist = (value: any) => { op = value; opPath = save(`review-${++serial}.json`, op); };
    const doc = join(dir, "pilot.hwpx"), finalDoc = join(dir, "final.hwpx");
    // A deliberately minimal synthetic ZIP, not a qualified Hancom document.
    const zip = Bun.spawnSync(["python3", "-c", "import zipfile,sys\nfor p in sys.argv[1:]:\n with zipfile.ZipFile(p,'w') as z:\n  z.writestr('mimetype','application/hwp+zip')\n  z.writestr('Contents/section0.xml','<section><p>synthetic</p></section>')", doc, finalDoc]);
    expect(zip.exitCode).toBe(0);
    const oracle = join(dir, "oracle.py");
    writeFileSync(oracle, "import json,sys,zipfile,xml.etree.ElementTree as ET\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.read('mimetype') == b'application/hwp+zip'\n assert ET.fromstring(z.read('Contents/section0.xml')).tag == 'section'\nprint(json.dumps({'checks':[{'name':'synthetic zip and XML inspection','status':'passed'}],'native':{'status':'unknown','evidence':None}}))\n");
    const comparison = join(dir, "comparison.svg"); writeFileSync(comparison, '<svg xmlns="http://www.w3.org/2000/svg"><text>synthetic source/result</text></svg>');
    const candidate = (kind: string, document: string) => {
      const report = run(["check", "--document", document, "--oracle", oracle]);
      const reportPath = save(`${kind}-verification.json`, report);
      return run(["candidate", "--file", opPath, ...unitArgs, "--kind", kind,
        "--document", document, "--comparison", comparison, "--verification", reportPath,
        "--document-url", "https://example.test/document", "--comparison-url", "https://example.test/comparison"]);
    };
    persist(candidate("pilot", doc));
    expect(run(["plan", "--file", opPath, ...unitArgs]).scaleReady).toBe(false);
    const decide = (decision: string) => run(["decide", "--file", opPath, ...unitArgs, "--event", save(`decision-${serial}.json`, { revision: op.candidates.at(-1).revision, decision, actor: "user", instruction: "Synthetic user instruction" })]);
    persist(decide("accept"));
    expect(run(["plan", "--file", opPath, ...unitArgs]).scaleReady).toBe(true);
    const q3 = JSON.parse(readFileSync(paths[2], "utf8")); q3.stages.find((s: any) => s.stage === "semantics").unresolved = ["illegible label"]; save("q3.json", q3);
    persist(run(["issue", "--file", opPath, "--event", save("issue.json", { id: "U1", questionId: "Q3", stage: "semantics", item: "illegible label", location: "Q3 top label", impact: "source-meaning", evidence: "Synthetic source occlusion", conflictsWithDecision: false })]));
    const agentEvent = save("agent.json", { issueId: "U1", disposition: "reading", actor: "agent", instruction: "Unsupported guess" });
    expect(run(["resolve", "--file", opPath, "--event", agentEvent], false)).toContain("human_resolution_required");
    persist(run(["resolve", "--file", opPath, "--event", save("user.json", { issueId: "U1", disposition: "authorized-residual", actor: "user", instruction: "Keep an explicit unknown label in the output" })]));
    persist(candidate("final", finalDoc));
    expect(run(["plan", "--file", opPath, ...unitArgs]).deliveryReady).toBe(false);
    expect(run(["release", "--file", opPath, ...unitArgs], false)).toContain("delivery_blocked");
    persist(decide("accept"));
    const plan = run(["plan", "--file", opPath, ...unitArgs]);
    expect(plan.deliveryReady).toBe(true); expect(plan.nativeVerified).toBe(false); expect(plan.residuals).toHaveLength(1);
    expect(run(["release", "--file", opPath, ...unitArgs]).candidate.revision).toBe(op.candidates.at(-1).revision);
    writeFileSync(finalDoc, "changed after approval");
    expect(run(["plan", "--file", opPath, ...unitArgs]).deliveryReady).toBe(false);
    expect(run(["release", "--file", opPath, ...unitArgs], false)).toContain("delivery_blocked");
    expect(run(["decide", "--file", opPath, ...unitArgs, "--event", save("stale.json", { revision: op.candidates.at(-1).revision, decision: "accept", actor: "user", instruction: "Stale approval attempt" })], false)).toContain("stale_approval_artifact");
    writeFileSync(oracle, "import json\nprint(json.dumps({'checks':[{'name':'deliberate failure','status':'failed'}],'native':{'status':'unknown'}}))\n");
    expect(run(["check", "--document", doc, "--oracle", oracle], false)).toContain("verification_failed");
    writeFileSync(oracle, "print('success without inspecting artifacts')\n");
    expect(run(["check", "--document", doc, "--oracle", oracle], false)).toContain("oracle_json");
    writeFileSync(oracle, "import json\nprint(json.dumps({'checks':[],'native':{'status':'unknown'}}))\n");
    expect(run(["check", "--document", doc, "--oracle", oracle], false)).toContain("verification_checks");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
