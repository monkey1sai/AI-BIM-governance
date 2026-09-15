import { useLang } from "../i18n";

/** Navigation guidance, not runtime progress. Never implies completion of a step. */
export function WorkflowOrientation() {
  const zh = useLang() === "zh";
  const steps = zh ? [
    ["01", "選擇模型", "確認專案、IFC 檔名與版本。", "#minio"],
    ["02", "確認轉檔", "IFC 轉為 USDC，完成後才能建立審查。", "#conv"],
    ["03", "開啟審查與 3D", "選擇已轉檔模型，再明確啟動 3D。", "#a1"],
    ["04", "檢核與定位", "確認畫面模型正確，再高亮、剖切及查看問題。", "#a1"],
  ] : [
    ["01", "Choose a model", "Check the project, IFC filename and version.", "#minio"],
    ["02", "Check conversion", "Convert IFC to USDC before creating a review.", "#conv"],
    ["03", "Open review and 3D", "Choose a converted model, then explicitly start 3D.", "#a1"],
    ["04", "Inspect and locate", "Verify the loaded model before highlighting or sectioning.", "#a1"],
  ];
  return <section className="op-orientation" aria-labelledby="op-workflow-title">
    <div className="op-intro">
      <div><p className="op-eyebrow">{zh ? "從模型開始" : "START WITH A MODEL"}</p>
        <h1 id="op-workflow-title">{zh ? "讓每一步操作，都有明確的下一步。" : "A clear next step, from model to review."}</h1>
        <p>{zh ? "下方是操作順序，不是即時完成進度。模型資料、審查紀錄與 3D 連線各自有不同狀態。" : "This is an operating guide, not live progress. Model data, review records and 3D connections have separate states."}</p>
      </div>
      <a className="op-primary" href="#minio">{zh ? "選擇我的模型" : "Choose my model"}</a>
    </div>
    <ol className="op-steps">{steps.map(([number, title, description, href]) => <li key={number}>
      <span className="op-step-number">{number}</span><h2><a href={href}>{title}</a></h2><p>{description}</p>
    </li>)}</ol>
    <details className="op-help"><summary>{zh ? "IFC、USDC、審查、Kit / GPU 分別是什麼？" : "How do IFC, USDC, reviews and Kit / GPU relate?"}</summary>
      <dl>
        <div><dt>IFC → USDC</dt><dd>{zh ? "IFC 是來源模型；USDC 是轉檔後供 3D 載入的模型。看到檔案不等於轉檔完成。" : "IFC is the source. USDC is the converted 3D artifact. File availability does not prove conversion is complete."}</dd></div>
        <div><dt>{zh ? "審查（Review Session）" : "Review session"}</dt><dd>{zh ? "審查紀錄綁定模型版本，不是另一份 IFC。同一模型可以有多筆審查，所以切換審查不一定會改變畫面。" : "A review binds a model version; it is not an IFC file. Multiple reviews can share one model and look identical."}</dd></div>
        <div><dt>Kit / GPU → 3D Viewer</dt><dd>{zh ? "Kit 使用 GPU 算出畫面，再串流到瀏覽器。服務正常、取得操作權和實際收到畫面是三件不同的事。" : "Kit renders on a GPU and streams to the browser. Service health, control ownership and received frames are different evidence."}</dd></div>
      </dl>
    </details>
    <details className="op-help"><summary>{zh ? "看不到 3D，或顯示有人占用，該怎麼辦？" : "No 3D image, or control is occupied?"}</summary>
      <p>{zh ? "先確認模型已轉檔、審查已選取，再按「啟動 3D」。若操作權被占用，先在原分頁離開 3D；找不到原分頁時，到審查與連線管理查看狀態。不要反覆建立新審查來排除串流問題。" : "Verify conversion and select a review, then start 3D. If control is occupied, leave 3D in the original tab or inspect review management. Creating more reviews does not resolve streaming failures."}</p>
      <a href="#sessions">{zh ? "查看審查與連線管理" : "Open review and connection management"}</a>
      <p>{zh ? "「離開 3D」釋放本次連線；「結束審查」會封存整筆審查且不可恢復為 active，兩者不同。" : "Leaving 3D releases this connection. Closing a review archives it irreversibly; these are not the same action."}</p>
    </details>
  </section>;
}
