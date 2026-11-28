'use client'

import { CopyField } from './copy-field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

export interface CodeTab {
  id: string
  label: string
  /** Where the code goes: "app/api/health/route.ts". */
  file?: string
  code: string
}

/** Code for several stacks, one tab each, with a copy button. */
export function CodeTabs({
  tabs,
  label,
  copy,
  copied,
}: {
  tabs: CodeTab[]
  /** What the tabs choose between, for screen readers: "Framework". */
  label: string
  copy: string
  copied: string
}) {
  const first = tabs[0]
  if (!first) return null
  return (
    <Tabs defaultValue={first.id} className="gap-2">
      <TabsList
        aria-label={label}
        className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
      >
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} className="h-8 flex-none px-2.5">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="flex flex-col gap-2">
          {tab.file && <p className="font-mono text-xs text-muted-foreground">{tab.file}</p>}
          <CopyField value={tab.code} copyLabel={copy} copiedLabel={copied} multiline />
        </TabsContent>
      ))}
    </Tabs>
  )
}
