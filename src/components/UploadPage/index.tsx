'use client'

import { BorderBeam, NumberTicker, ReButton, ReTooltip } from '@/components'
import { FieldConstraints, IconNames } from '@cfg'
import {
  addToast,
  ButtonGroup,
  Checkbox,
  CheckboxGroup,
  cn,
  Divider,
  Radio,
  RadioGroup,
} from '@heroui/react'
import { useSetState } from 'ahooks'
import { TreeDataNode } from 'antd'
import { motion } from 'framer-motion'
import { pick } from 'lodash'
import { nanoid } from 'nanoid'
import dynamic from 'next/dynamic'
import { useMemo, useRef } from 'react'
import { LinkTagStrategy } from './common'
import ExportBookmarksGuide from './components/ExportBookmarksGuide'
import Panel from './components/Panel'
import UploadList from './components/UploadList'

const DynamicTree = dynamic(() => import('antd/es/tree').then((m) => m.default))

interface CategoryNode {
  id: string
  type: 'category'
  name: string
  nodes: (CategoryNode | BookmarkNode)[]
}
interface BookmarkNode {
  id: string
  type: 'bookmark'
  name: string
  url: string
  categories: Category[]
}
type Category = Pick<CategoryNode, 'id' | 'name'>
export type Bookmark = Pick<BookmarkNode, 'id' | 'name' | 'url' | 'categories'>

const ROOT_ID = '0'

/**
 * 页面：上传浏览器导出的书签数据
 *
 * 浏览器导出的书签中的目录允许重名
 */
export default function UploadPage() {
  const inputRef = useRef<null | HTMLInputElement>(null)
  const [state, setState] = useSetState({
    file: null as null | File,
    nodes: [] as CategoryNode['nodes'],
    openedCategoryIds: [] as string[],
    checkedLinkableTags: [] as string[],
    linkTagStrategy: LinkTagStrategy.FOLDER_PATH,
    checkedTreeKeys: [] as string[],
    showUploadList: false,
  })

  async function readFile(file: File) {
    function traverseDl(dl: HTMLDListElement, parentCates: Category[] = []): CategoryNode['nodes'] {
      return [...dl.querySelectorAll<HTMLDetailsElement>('& > dt').entries()]
        .map(([_, dt]) => traverseDt(dt, parentCates))
        .filter((e) => e !== null) as CategoryNode['nodes']
    }
    function traverseDt(
      dt: HTMLDetailsElement,
      parentCates: Category[]
    ): BookmarkNode | CategoryNode | null {
      const h3 = dt.querySelector<HTMLHeadingElement>('& > h3')
      const dl = dt.querySelector<HTMLDListElement>('& > dl')
      const a = dt.querySelector<HTMLAnchorElement>('& > a')
      if (h3 && dl) {
        const node: CategoryNode = {
          id: nanoid(),
          type: 'category',
          // 目录名称最终会作为标签成为 url 中的一部分，因此不能带 / 字符
          // 标签交叉搜索时，会用 + 链接多个标签，因此不能带 + 字符
          name: h3.innerText.replaceAll(/[/+\s]/g, '-'),
          nodes: [],
        }
        const nodes = traverseDl(dl, parentCates.concat(pick(node, 'id', 'name')))
        // 过滤内容为空的目录
        if (!nodes.length) return null
        node.nodes = nodes
        return node
      }
      if (a) {
        const node: BookmarkNode = {
          id: nanoid(),
          type: 'bookmark',
          url: a.href,
          name: a.innerText,
          categories: parentCates,
        }
        return node
      }
      throw new Error()
    }

    const text = await file.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, 'text/html')
    const dl = doc.querySelector<HTMLDListElement>('body > dl')
    if (!dl) throw new Error()
    // 塞入一个虚拟的 Root 节点，方便数据处理
    const nodes: CategoryNode['nodes'] = [
      { id: ROOT_ID, name: '(Root)', type: 'category', nodes: traverseDl(dl) },
    ]
    // console.log(doc)
    // console.log(nodes)
    setState({ nodes, openedCategoryIds: [ROOT_ID] })
  }

  const categoryTree = useMemo<TreeDataNode[]>(() => {
    function traverse(nodes: CategoryNode['nodes']) {
      const result: TreeDataNode['children'] = []
      for (const node of nodes) {
        if (node.type === 'category') {
          const children: TreeDataNode[] = []
          if (node.nodes.find((e) => e.type === 'bookmark')) {
            children.push({
              key: node.id + '@',
              title: '(当前目录层级的书签)',
            })
          }
          result.push({
            key: node.id,
            title: node.name,
            children: traverse(node.nodes).concat(children),
          })
        }
      }
      return result
    }
    return traverse(state.nodes)
  }, [state.nodes])

  const allCategories = useMemo<Category[]>(() => {
    function traverse(nodes: CategoryNode['nodes']) {
      const result: Pick<CategoryNode, 'id' | 'name'>[] = []
      for (const node of nodes) {
        if (node.type === 'category') {
          result.push(pick(node, 'id', 'name'), ...traverse(node.nodes))
        }
      }
      return result
    }
    const list = traverse(state.nodes)
    setState({ checkedTreeKeys: list.map((e) => e.id) })
    return list
  }, [setState, state.nodes])

  const allBookmarks = useMemo<Bookmark[]>(() => {
    function traverse(nodes: CategoryNode['nodes']) {
      const result: Bookmark[] = []
      for (const node of nodes) {
        if (node.type === 'bookmark') {
          result.push(pick(node, 'id', 'name', 'url', 'categories'))
        } else if (node.type === 'category') {
          result.push(...traverse(node.nodes))
        }
      }
      return result
    }
    return traverse(state.nodes)
  }, [state.nodes])

  /**
   * 将要导入的所有书签的
   */
  const waitUploadBookmarks = useMemo(() => {
    const bookmarks: Bookmark[] = []
    function traverse(nodes: CategoryNode['nodes']) {
      for (const node of nodes) {
        if (node.type !== 'category') continue
        if (
          state.checkedTreeKeys.includes(node.id) ||
          state.checkedTreeKeys.includes(node.id + '@')
        ) {
          node.nodes.forEach((el) => {
            el.type === 'bookmark' && bookmarks.push(el)
          })
        }
        traverse(node.nodes)
      }
    }
    traverse(state.nodes)
    return bookmarks
  }, [state.checkedTreeKeys, state.nodes])

  /** 可关联的标签 */
  const linkableTags = useMemo<string[]>(() => {
    const names: Set<string> = new Set(['其它'])
    if (state.linkTagStrategy !== LinkTagStrategy.OTHER) {
      const linkNames = waitUploadBookmarks.flatMap((b) => b.categories.map((c) => c.name))
      if (state.linkTagStrategy === LinkTagStrategy.CLOSED_FOLDER && linkNames.length) {
        names.add(linkNames.pop()!)
      } else {
        linkNames.forEach((val) => names.add(val))
      }
    }
    setState({
      checkedLinkableTags: [...names].filter((e) => {
        return e !== '书签栏' && e.length <= FieldConstraints.MaxLen.TAG_NAME
      }),
    })
    return [...names]
  }, [setState, state.linkTagStrategy, waitUploadBookmarks])

  function renderTree() {
    function toggleFolderOpen(id: string) {
      const ids = state.openedCategoryIds
      if (ids.includes(id)) {
        setState({ openedCategoryIds: ids.filter((_id) => _id !== id) })
      } else {
        setState({ openedCategoryIds: ids.concat(id) })
      }
    }
    function renderCategory(node: CategoryNode) {
      return (
        <section key={node.id} className="ml-6 flex flex-col py-0.5">
          <div>
            <button
              className="-mx-2 inline-flex grow-0 items-center gap-2 rounded px-2 py-0.5 text-primary-500 hover:bg-foreground-200"
              onClick={() => toggleFolderOpen(node.id)}
            >
              <span
                className={cn(
                  state.openedCategoryIds.includes(node.id)
                    ? 'icon-[tabler--folder-open]'
                    : 'icon-[tabler--folder]'
                )}
              />
              <span>{node.name}</span>
            </button>
          </div>
          <motion.section
            initial={false}
            animate={{ height: state.openedCategoryIds.includes(node.id) ? 'auto' : 0 }}
            className="overflow-hidden"
          >
            {node.nodes.map((childNode) => {
              if (childNode.type === 'category') return renderCategory(childNode)
              if (childNode.type === 'bookmark') return renderBookmark(childNode)
            })}
          </motion.section>
        </section>
      )
    }
    function renderBookmark(node: BookmarkNode) {
      return (
        <section key={node.id} className="ml-6 py-1">
          <a
            href={node.url}
            className="inline-flex max-w-full items-center gap-2 text-foreground-700 hover:opacity-70"
            target="_blank"
          >
            <span className="icon-[hugeicons--internet]" />
            <span className="truncate">{node.name}</span>
          </a>
        </section>
      )
    }
    return (
      <div>
        <div className="mb-2 flex">
          <ButtonGroup>
            <ReButton
              size="sm"
              startContent={<span className="icon-[tabler--arrows-move-vertical] text-xl" />}
              onClick={() => setState({ openedCategoryIds: allCategories.map((e) => e.id) })}
            >
              展开全部
            </ReButton>
            <ReButton
              size="sm"
              startContent={<span className={'icon-[tabler--fold] text-xl'} />}
              onClick={() => setState({ openedCategoryIds: [] })}
            >
              收起全部
            </ReButton>
          </ButtonGroup>
          <ReButton
            size="sm"
            className="ml-auto"
            startContent={<span className={'icon-[tabler--arrow-back-up] text-xl'} />}
            onClick={() => {
              setState({ file: null })
              inputRef.current!.value = ''
            }}
          >
            重新选择
          </ReButton>
        </div>
        <div className="-ml-4 text-sm">
          {state.nodes.map((node) => {
            if (node.type === 'category') return renderCategory(node)
            if (node.type === 'bookmark') return renderBookmark(node)
          })}
        </div>
      </div>
    )
  }

  async function submitConfig() {
    if (waitUploadBookmarks.length === 0) {
      addToast({
        color: 'warning',
        description: '没有书签要上传，请检查「导入配置」',
      })
      return
    }
    setState({ showUploadList: true })
  }

  return (
    <main className="py-20 flex-center">
      <div className={cn(state.file && '!hidden', 'w-[30rem] text-center')}>
        <span
          className={cn(IconNames.IMPORT, 'bg-gradient-to-r from-rose-500 to-purple-500 text-6xl')}
        />
        <h1 className="mb-10 mt-8 text-xl">导入浏览器书签</h1>
        <div
          className={cn(
            'relative h-[280px] cursor-pointer flex-col gap-4 rounded-xl border border-foreground-200 text-foreground-400 flex-center',
            'transition hover:text-foreground-600'
          )}
          onClick={() => inputRef.current?.click()}
        >
          <BorderBeam size={140} duration={12} delay={6} />
          <span className={cn(IconNames.PLUS, 'text-3xl')} />
          <span>选择文件</span>
          <input
            className="hidden"
            type="file"
            accept=".html"
            ref={inputRef}
            onChange={(evt) => {
              const files = evt.target.files
              if (files?.length !== 1) return
              setState({ file: files[0] })
              readFile(files[0])
            }}
          />
        </div>
        <ExportBookmarksGuide />
      </div>

      <div className={cn((!state.file || state.showUploadList) && 'hidden')}>
        <Panel className="mb-10">
          <h2 className="mb-4 gap-2 text-xl flex-items-center">
            <span className="icon-[hugeicons--file-01] text-2xl" />
            <span>{state.file?.name}</span>
          </h2>
          <Divider className="mb-5" />
          {renderTree()}
        </Panel>

        <Panel className='[&_[role="radiogroup"]_label_div]:ml-2'>
          <h2 className="mb-4 gap-2 text-xl flex-items-center">
            <span className="icon-[hugeicons--settings-05] text-2xl" />
            <span>导入配置</span>
          </h2>
          <Divider />

          <div className="mt-4 text-sm text-foreground-500">
            <div className="text-base">注意事项</div>
            <ul className="ml-5 mt-2 list-disc space-y-1 text-foreground-800">
              <li>原始的目录将会作为标签存在（仅用标签组织、关联书签）</li>
              <li>已过滤内容为空的目录</li>
              <li>书签至少会被关联「其它」标签</li>
              <li className="font-extrabold">如无特定需求，使用默认配置即可</li>
            </ul>
          </div>

          <RadioGroup
            label="标签关联策略"
            size="sm"
            className="mt-8"
            value={state.linkTagStrategy}
            onValueChange={(v) => setState({ linkTagStrategy: v as LinkTagStrategy })}
          >
            <ReTooltip
              offset={0}
              content="例：某书签在目录「foo > bar」中，则该书签将关联「foo」和「bar」标签"
            >
              <Radio value={LinkTagStrategy.FOLDER_PATH}>按照目录层级，分别关联标签</Radio>
            </ReTooltip>
            <ReTooltip
              offset={0}
              content="例：某书签在目录「foo > bar」中，则该书签仅关联「bar」标签"
            >
              <Radio value={LinkTagStrategy.CLOSED_FOLDER}>仅将最近的目录作为标签进行关联</Radio>
            </ReTooltip>
            <Radio value={LinkTagStrategy.OTHER}>全部书签关联「其它」标签</Radio>
          </RadioGroup>

          <div className="mt-8">
            <label className="text-base text-foreground-500">选择书签</label>
            <DynamicTree
              key={categoryTree.length}
              rootClassName="!mt-2 !bg-transparent "
              checkable
              selectable={false}
              treeData={categoryTree}
              checkedKeys={state.checkedTreeKeys}
              onCheck={(keys) => setState({ checkedTreeKeys: keys as string[] })}
              defaultExpandedKeys={[ROOT_ID]}
            />
            <p className="mt-2 text-sm text-foreground-400">
              将导入 <NumberTicker value={waitUploadBookmarks.length} /> 个书签 / 共{' '}
              {allBookmarks.length} 个
            </p>
          </div>

          <div className="mt-8">
            <label className="gap-2 text-base text-foreground-500 flex-items-center">
              <span>可关联的标签</span>
              <ReTooltip
                content={
                  <div>
                    <p>仅影响书签可关联的标签，不影响导入的书签数量。</p>
                    <p>
                      标签应该是简洁明了的，因此无法关联超过 {FieldConstraints.MaxLen.TAG_NAME}{' '}
                      个字符的标签。
                    </p>
                  </div>
                }
              >
                <span className={cn(IconNames.QUESTION_CIRCLE, 'cursor-pointer')} />
              </ReTooltip>
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <CheckboxGroup
                orientation="horizontal"
                color="default"
                size="sm"
                value={state.checkedLinkableTags}
                onChange={(v) => setState({ checkedLinkableTags: v })}
              >
                {linkableTags.map((tag) => (
                  <Checkbox
                    key={tag}
                    value={tag}
                    isDisabled={'其它' === tag || tag.length > FieldConstraints.MaxLen.TAG_NAME}
                  >
                    {tag}
                  </Checkbox>
                ))}
              </CheckboxGroup>
            </div>
          </div>

          <ReButton fullWidth size="lg" className="mt-10 bg-opacity-50" onClick={submitConfig}>
            确认配置，预览上传列表
          </ReButton>
        </Panel>
      </div>

      {state.showUploadList && (
        <UploadList
          tagNames={state.checkedLinkableTags}
          bookmarks={waitUploadBookmarks}
          linkTagStrategy={state.linkTagStrategy}
          onCancel={() => setState({ showUploadList: false })}
        />
      )}
    </main>
  )
}
