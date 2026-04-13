import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FlatTreeControl } from '@angular/cdk/tree';
import { MatTreeFlatDataSource, MatTreeFlattener } from '@angular/material/tree';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ApiService, PaginatedResponse } from '../../core/services/api.service';

interface Category {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  children?: Category[];
}

interface FlatCategory {
  id: string;
  name: string;
  description: string | null;
  level: number;
  expandable: boolean;
}

interface Specification {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  headcount: number;
  tools_addons: string[];
  status: string;
  daily_capacity: number | null;
  created_at: string;
}

interface PricingRule {
  id: string;
  spec_id: string;
  rule_type: string;
  base_price: number | null;
  tier_config: Record<string, unknown>[] | null;
  surcharge_label: string | null;
  surcharge_amount: number | null;
}

@Component({
  selector: 'app-service-catalog',
  templateUrl: './service-catalog.component.html',
  styleUrls: ['./service-catalog.component.scss']
})
export class ServiceCatalogComponent implements OnInit, OnDestroy {
  // Tree
  categories: Category[] = [];
  selectedCategoryId = '';

  private transformer = (node: Category, level: number): FlatCategory => ({
    id: node.id,
    name: node.name,
    description: node.description,
    level: level,
    expandable: !!(node.children && node.children.length > 0)
  });

  treeControl = new FlatTreeControl<FlatCategory>(
    node => node.level,
    node => node.expandable
  );

  treeFlattener = new MatTreeFlattener(
    this.transformer,
    node => node.level,
    node => node.expandable,
    node => node.children || []
  );

  dataSource = new MatTreeFlatDataSource(this.treeControl, this.treeFlattener);

  // Specifications
  specifications: Specification[] = [];
  displayedColumns = ['name', 'duration_minutes', 'headcount', 'status', 'actions'];
  totalSpecs = 0;
  specPage = 1;
  specPageSize = 25;

  // Forms
  specForm!: FormGroup;
  categoryForm!: FormGroup;
  pricingForm!: FormGroup;

  // State
  isLoading = true;
  specsLoading = false;
  errorMessage = '';
  showSpecForm = false;
  showCategoryForm = false;
  showPricingForm = false;
  isSaving = false;
  editingSpec: Specification | null = null;
  pricingRules: PricingRule[] = [];
  pricingLoading = false;
  selectedSpec: Specification | null = null;
  showCapacityForm = false;
  capacityForm!: FormGroup;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar
  ) {}

  hasChild = (_: number, node: FlatCategory) => node.expandable;

  ngOnInit(): void {
    this.specForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(255)]],
      description: [''],
      category_id: ['', Validators.required],
      duration_minutes: [60, [Validators.required, Validators.min(15), Validators.max(480)]],
      headcount: [1, [Validators.required, Validators.min(1), Validators.max(20)]],
      tools_addons: [''],
      daily_capacity: [null, Validators.min(1)]
    });

    this.categoryForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      parent_id: [null]
    });

    this.pricingForm = this.fb.group({
      rule_type: ['base', Validators.required],
      base_price: [0, [Validators.required, Validators.min(0)]],
      surcharge_label: [''],
      surcharge_amount: [0]
    });

    this.capacityForm = this.fb.group({
      date: ['', Validators.required],
      max_volume: [10, [Validators.required, Validators.min(1)]],
      is_stopped: [false]
    });

    this.loadCategories();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCategories(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.api.get<{ data: Category[] } | Category[]>('/services/categories').pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (cats: any) => {
        const arr = cats?.data || cats;
        this.categories = Array.isArray(arr) ? arr : [];
        this.buildTree();
        this.isLoading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load service categories.';
        this.isLoading = false;
      }
    });
  }

  buildTree(): void {
    const map = new Map<string | null, Category[]>();
    this.categories.forEach(c => {
      const parentId = c.parent_id;
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId)!.push(c);
    });

    const buildChildren = (parentId: string | null): Category[] => {
      const children = map.get(parentId) || [];
      return children.map(c => ({
        ...c,
        children: buildChildren(c.id)
      }));
    };

    this.dataSource.data = buildChildren(null);
  }

  selectCategory(node: FlatCategory): void {
    this.selectedCategoryId = node.id;
    this.specForm.patchValue({ category_id: node.id });
    this.loadSpecifications();
  }

  loadSpecifications(): void {
    if (!this.selectedCategoryId) return;
    this.specsLoading = true;

    this.api.get<PaginatedResponse<Specification>>('/services/specifications', {
      page: this.specPage,
      pageSize: this.specPageSize,
      category_id: this.selectedCategoryId
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.specifications = res.data || [];
        this.totalSpecs = res.total || 0;
        this.specsLoading = false;
      },
      error: () => {
        this.specifications = [];
        this.specsLoading = false;
      }
    });
  }

  onSpecPageChange(event: PageEvent): void {
    this.specPage = event.pageIndex + 1;
    this.specPageSize = event.pageSize;
    this.loadSpecifications();
  }

  // Category CRUD
  createCategory(): void {
    if (this.categoryForm.invalid) return;
    this.isSaving = true;

    const body = { ...this.categoryForm.value };
    if (this.selectedCategoryId) {
      body.parent_id = this.selectedCategoryId;
    }

    this.api.post('/services/categories', body).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.isSaving = false;
        this.showCategoryForm = false;
        this.categoryForm.reset();
        this.snackBar.open('Category created', 'Close', { duration: 3000 });
        this.loadCategories();
      },
      error: () => {
        this.isSaving = false;
        this.snackBar.open('Failed to create category', 'Close', { duration: 3000 });
      }
    });
  }

  // Specification CRUD
  openSpecForm(spec?: Specification): void {
    this.editingSpec = spec || null;
    this.showSpecForm = true;

    if (spec) {
      this.specForm.patchValue({
        name: spec.name,
        description: spec.description || '',
        category_id: spec.category_id,
        duration_minutes: spec.duration_minutes,
        headcount: spec.headcount,
        tools_addons: (spec.tools_addons || []).join(', '),
        daily_capacity: spec.daily_capacity
      });
    } else {
      this.specForm.reset({
        category_id: this.selectedCategoryId,
        duration_minutes: 60,
        headcount: 1
      });
    }
  }

  saveSpec(): void {
    if (this.specForm.invalid) return;
    this.isSaving = true;

    const formValue = this.specForm.value;
    const body = {
      ...formValue,
      tools_addons: formValue.tools_addons
        ? formValue.tools_addons.split(',').map((s: string) => s.trim()).filter((s: string) => s)
        : [],
      duration_minutes: Math.round(formValue.duration_minutes / 15) * 15
    };

    if (body.tools_addons.length > 30) {
      this.snackBar.open('Maximum 30 tools/addons allowed', 'Close', { duration: 3000 });
      this.isSaving = false;
      return;
    }

    const request = this.editingSpec
      ? this.api.put(`/services/specifications/${this.editingSpec.id}`, body)
      : this.api.post('/services/specifications', body);

    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.isSaving = false;
        this.showSpecForm = false;
        this.editingSpec = null;
        this.snackBar.open(this.editingSpec ? 'Specification updated' : 'Specification created', 'Close', { duration: 3000 });
        this.loadSpecifications();
      },
      error: () => {
        this.isSaving = false;
        this.snackBar.open('Failed to save specification', 'Close', { duration: 3000 });
      }
    });
  }

  updateSpecStatus(spec: Specification, newStatus: string): void {
    this.api.put(`/services/specifications/${spec.id}/status`, { status: newStatus }).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.snackBar.open('Status updated', 'Close', { duration: 2000 });
        this.loadSpecifications();
      },
      error: () => {
        this.snackBar.open('Failed to update status', 'Close', { duration: 3000 });
      }
    });
  }

  // Pricing
  openPricing(spec: Specification): void {
    this.selectedSpec = spec;
    this.showPricingForm = true;
    this.loadPricingRules(spec.id);
  }

  loadPricingRules(specId: string): void {
    this.pricingLoading = true;
    this.api.get<PricingRule[]>(`/services/specifications/${specId}/pricing`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (rules) => {
        this.pricingRules = Array.isArray(rules) ? rules : [];
        this.pricingLoading = false;
      },
      error: () => {
        this.pricingRules = [];
        this.pricingLoading = false;
      }
    });
  }

  savePricingRule(): void {
    if (!this.selectedSpec || this.pricingForm.invalid) return;
    this.isSaving = true;

    this.api.post(`/services/specifications/${this.selectedSpec.id}/pricing`, this.pricingForm.value).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.isSaving = false;
        this.pricingForm.reset({ rule_type: 'base', base_price: 0 });
        this.snackBar.open('Pricing rule added', 'Close', { duration: 3000 });
        this.loadPricingRules(this.selectedSpec!.id);
      },
      error: () => {
        this.isSaving = false;
        this.snackBar.open('Failed to add pricing rule', 'Close', { duration: 3000 });
      }
    });
  }

  deletePricingRule(rule: PricingRule): void {
    if (!this.selectedSpec) return;
    this.api.delete(`/pricing/${rule.id}`).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.snackBar.open('Pricing rule removed', 'Close', { duration: 2000 });
        this.loadPricingRules(this.selectedSpec!.id);
      },
      error: () => {
        this.snackBar.open('Failed to remove pricing rule', 'Close', { duration: 3000 });
      }
    });
  }

  // Capacity
  openCapacity(spec: Specification): void {
    this.selectedSpec = spec;
    this.showCapacityForm = true;
    this.capacityForm.reset({ max_volume: spec.daily_capacity || 10, is_stopped: false });
  }

  saveCapacity(): void {
    if (!this.selectedSpec || this.capacityForm.invalid) return;
    this.isSaving = true;

    this.api.post(`/services/specifications/${this.selectedSpec.id}/capacity`, this.capacityForm.value).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: () => {
        this.isSaving = false;
        this.showCapacityForm = false;
        this.snackBar.open('Capacity settings saved', 'Close', { duration: 3000 });
      },
      error: () => {
        this.isSaving = false;
        this.snackBar.open('Failed to save capacity', 'Close', { duration: 3000 });
      }
    });
  }

  getStatusBadgeClass(status: string): string {
    return `status-${status}`;
  }

  cancelSpecForm(): void {
    this.showSpecForm = false;
    this.editingSpec = null;
  }
}
