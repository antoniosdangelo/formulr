// Generates the add-in only manifest for the origin the Worker is served from.
// Structure follows Microsoft's excel-shared-runtime-global-state sample (custom functions + shared runtime).

import { VERSION } from "./core.js";

export const ADD_IN_ID = "d6f74f7a-8e8f-408c-95b6-c9e86d259625";
export const NAMESPACE = "FORMULR";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderManifest(origin, addInId = ADD_IN_ID) {
  const o = esc(origin);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
  xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>${/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(addInId) ? addInId : ADD_IN_ID}</Id>
  <Version>${VERSION}.0</Version>
  <ProviderName>Formulr</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Formulr"/>
  <Description DefaultValue="AI formulas for Excel: =FORMULR.ANSWER(B2) answers any text or range and explains it, =FORMULR.ASK follows your instruction, =FORMULR.EXTRACT pulls fields from text. Works with any length and format."/>
  <IconUrl DefaultValue="${o}/icon-32.png?v=2"/>
  <HighResolutionIconUrl DefaultValue="${o}/icon-80.png?v=2"/>
  <SupportUrl DefaultValue="${o}/index.html"/>
  <AppDomains>
    <AppDomain>${o}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Workbook"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="SharedRuntime" MinVersion="1.1"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${o}/taskpane.html"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Workbook">
        <Runtimes>
          <Runtime resid="Taskpane.Url" lifetime="long"/>
        </Runtimes>
        <AllFormFactors>
          <ExtensionPoint xsi:type="CustomFunctions">
            <Script>
              <SourceLocation resid="Functions.Script.Url"/>
            </Script>
            <Page>
              <SourceLocation resid="Taskpane.Url"/>
            </Page>
            <Metadata>
              <SourceLocation resid="Functions.Metadata.Url"/>
            </Metadata>
            <Namespace resid="Functions.Namespace"/>
          </ExtensionPoint>
        </AllFormFactors>
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <FunctionFile resid="Taskpane.Url"/>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="FormulrGroup">
                <Label resid="Group.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16x16"/>
                  <bt:Image size="32" resid="Icon.32x32"/>
                  <bt:Image size="80" resid="Icon.80x80"/>
                </Icon>
                <Control xsi:type="Button" id="PaneButton">
                  <Label resid="PaneButton.Label"/>
                  <Supertip>
                    <Title resid="PaneButton.Label"/>
                    <Description resid="PaneButton.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
                <Control xsi:type="Button" id="AskPictureButton">
                  <Label resid="AskPictureButton.Label"/>
                  <Supertip>
                    <Title resid="AskPictureButton.Label"/>
                    <Description resid="AskPictureButton.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <Action xsi:type="ExecuteFunction">
                    <FunctionName>askPicture</FunctionName>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16x16" DefaultValue="${o}/icon-16.png?v=2"/>
        <bt:Image id="Icon.32x32" DefaultValue="${o}/icon-32.png?v=2"/>
        <bt:Image id="Icon.80x80" DefaultValue="${o}/icon-80.png?v=2"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="Functions.Script.Url" DefaultValue="${o}/functions.js"/>
        <bt:Url id="Functions.Metadata.Url" DefaultValue="${o}/functions.json"/>
        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="${o}/index.html"/>
        <bt:Url id="Taskpane.Url" DefaultValue="${o}/taskpane.html"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="Functions.Namespace" DefaultValue="${NAMESPACE}"/>
        <bt:String id="GetStarted.Title" DefaultValue="Formulr is ready"/>
        <bt:String id="Group.Label" DefaultValue="Formulr"/>
        <bt:String id="PaneButton.Label" DefaultValue="Formulr"/>
        <bt:String id="AskPictureButton.Label" DefaultValue="Answer picture"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Open Formulr on the Home tab and enter your access code, then type =FORMULR.ANSWER(B2) in any cell."/>
        <bt:String id="PaneButton.Tooltip" DefaultValue="Open the Formulr pane to unlock it with your access code."/>
        <bt:String id="AskPictureButton.Tooltip" DefaultValue="Click a picture and press this, or press this and then click the picture within 20 seconds. The answer appears in the cell just right of the picture."/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`;
}
