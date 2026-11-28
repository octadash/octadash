'use client'

import type { ProductStatus } from '@/lib/monitors'
import { GroupForm, type GroupFormLabels } from './group-form'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

export interface NewGroupLabels {
  title: string
  intro: string
  cancel: string
  create: string
}

/** A group is a name and a set of products; the action opens it. */
export function NewGroupDialog({
  open,
  onOpenChange,
  products,
  labels,
  formLabels,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: { id: string; name: string; status: ProductStatus }[]
  labels: NewGroupLabels
  formLabels: GroupFormLabels
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>
        <GroupForm
          products={products}
          labels={formLabels}
          actions={
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="lg">
                  {labels.cancel}
                </Button>
              </DialogClose>
              <SubmitButton size="lg">{labels.create}</SubmitButton>
            </div>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
