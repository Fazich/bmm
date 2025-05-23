import { cn } from '@heroui/react'
import { PropsWithChildren } from 'react'

export default function Panel(props: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      role="upload-panel"
      className={cn(
        'w-[680px] rounded-xl bg-foreground-50 px-8 py-6 light:border dark:bg-black',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}
