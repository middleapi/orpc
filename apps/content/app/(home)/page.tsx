import { homeSource } from '@/lib/source'
import { cn } from '@/utils/cn'
import { Popup, PopupContent, PopupTrigger } from 'fumadocs-twoslash/ui'
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { DocsBody } from 'fumadocs-ui/page'
import Image from 'next/image'
import Link from 'next/link'

const mdxComponents = {
  pre: ({ children, ...props }: React.ComponentProps<'pre'>) => (
    <CodeBlock {...props}>
      <Pre className="max-h-[37.5rem]">{children}</Pre>
    </CodeBlock>
  ),
  Popup,
  PopupContent,
  PopupTrigger,
  Tab,
  Tabs: ({ children, ...props }: React.ComponentProps<typeof Tabs>) => (
    <Tabs
      {...props}
      className={cn(props.className, 'border-none rounded-none')}
    >
      {children}
    </Tabs>
  ),
}

export default function HomePage() {
  const landing = homeSource.getPage(['landing'])!
  const LandingMDX = landing.data.body
  const server = homeSource.getPage(['server'])!
  const ServerMDX = server.data.body
  const client = homeSource.getPage(['client'])!
  const ClientMDX = client.data.body

  return (
    <main className="container">
      <div className="mx-auto lg:col-span-6 lg:flex lg:items-center justify-center text-center">
        <div className="relative z-10 lg:h-auto pt-[90px] lg:pt-[90px] lg:min-h-[300px] flex flex-col items-center justify-center sm:mx-auto md:w-3/4 lg:mx-0 lg:w-full gap-4 lg:gap-8">
          <div className="flex flex-col items-center">
            <Image src="/logo.webp" alt="oRPC" width={500} height={100} unoptimized />
            <h1 className="max-w-4xl mt-5 text-#b4befe font-semibold text-4xl sm:text-5xl sm:leading-none lg:text-5xl">
              Typesafe API's Made Simple 🪄
            </h1>
            <p className="max-w-2xl pt-2 text-foreground my-3 text-xs sm:mt-5 lg:mb-0 sm:text-sm lg:text-base">
              End-to-End Typesafe API's made easy in a toolkit that helps developers build robust TypeScript API's with a focus on
              {' '}
              <strong className="font-semibold">developer experience</strong>
              ,
              {' '}
              <strong className="font-semibold">reliability</strong>
              .
            </p>
          </div>
          <div className="flex items-center gap-5">
            <Link
              type="button"
              className="bg-fd-primary/80 flex py-3 px-8 rounded-full cursor-pointer"
              href="/docs"

            >
              <span className="font-medium text-white/80">Quick start</span>
            </Link>
            <Link
              type="button"
              className="bg-fd-primary/20 bg-opacity-20 flex py-3 px-8 rounded-full cursor-pointer"
              href="https://github.com/unnoq/orpc"
              rel="noreferrer noopener"
              target="_blank"
            >
              <span className="text-fd-primary font-medium">View on GitHub</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-24 flex justify-center">
        <div className="min-[1247px]:flex flex-wrap justify-center rounded-md overflow-hidden ring-foreground/10 ring-1">
          <div className="w-[37.5rem] -mt-4 -mb-4 overflow-auto">
            <ServerMDX components={mdxComponents} />
          </div>
          <div className="w-[37.5rem] -mt-4 -mb-4 overflow-auto">
            <ClientMDX components={mdxComponents} />
          </div>
        </div>
      </div>

      <div className="mt-24 max-w-5xl mx-auto">
        <DocsBody>
          <LandingMDX components={mdxComponents} />
        </DocsBody>
      </div>

      {/* <div className="mt-24 grid grid-cols-6 gap-4">
        <div className="col-span-6 lg:col-span-4 h-64 bg-card ring-1 ring-foreground/10 rounded-md">
          End-to-end typesafe APIs
        </div>
        <div className="col-span-6 md:col-span-3 lg:col-span-2 h-64 bg-card ring-1 ring-foreground/10 rounded-md">
          First class OpenAPI supports
        </div>
        <div className="col-span-6 md:col-span-3 lg:col-span-2 h-64 bg-card ring-1 ring-foreground/10 rounded-md">
          Upload/Download Files supports
        </div>
        <div className="col-span-6 md:col-span-3 lg:col-span-2 h-64 bg-card ring-1 ring-foreground/10 rounded-md">
          Framework agnostic
        </div>
        <div className="col-span-6 md:col-span-3 lg:col-span-2 h-64 bg-card ring-1 ring-foreground/10 rounded-md">
          Server Actions supports
        </div>
      </div> */}
    </main>
  )
}
