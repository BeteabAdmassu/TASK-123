export type UserRole = 'admin' | 'recruiter' | 'reviewer' | 'approver';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  locale: string;
  force_password_change: boolean;
  created_at: Date;
  updated_at: Date;
}

export type ProjectStatus = 'draft' | 'active' | 'completed' | 'archived';

export interface RecruitingProject {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  created_by: string;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type PostingStatus = 'draft' | 'open' | 'closed';

export interface JobPosting {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  requirements: Record<string, unknown> | null;
  field_rules: Record<string, unknown> | null;
  status: PostingStatus;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type CandidateStatus = 'intake' | 'screening' | 'review' | 'approved' | 'rejected';

export interface Candidate {
  id: string;
  job_posting_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  ssn_encrypted: Buffer | null;
  dob_encrypted: Buffer | null;
  compensation_encrypted: Buffer | null;
  eeoc_disposition: string | null;
  status: CandidateStatus;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ResumeVersion {
  id: string;
  candidate_id: string;
  version_number: number;
  content: Record<string, unknown>;
  created_by: string;
  created_at: Date;
}

export type QualityStatus = 'pending' | 'passed' | 'failed';

export interface Attachment {
  id: string;
  candidate_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  page_count: number | null;
  quality_status: QualityStatus;
  quality_errors: Record<string, unknown> | null;
  created_at: Date;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

export type ViolationRuleType = 'prohibited_phrase' | 'missing_field' | 'duplicate_pattern' | 'custom';
export type ViolationSeverity = 'warning' | 'error' | 'critical';

export interface ViolationRule {
  id: string;
  rule_type: ViolationRuleType;
  rule_config: Record<string, unknown>;
  severity: ViolationSeverity;
  is_active: boolean;
  created_at: Date;
}

export type ViolationStatus = 'pending' | 'reviewed' | 'dismissed' | 'escalated';

export interface ViolationInstance {
  id: string;
  candidate_id: string;
  rule_id: string;
  details: Record<string, unknown>;
  status: ViolationStatus;
  reviewed_by: string | null;
  decision: string | null;
  review_comment: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

export interface AuditTrail {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface ServiceCategory {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ServiceAttribute {
  id: string;
  category_id: string;
  name: string;
  data_type: string;
  is_required: boolean;
}

export type SpecStatus = 'draft' | 'active' | 'paused' | 'retired';

export interface ServiceSpecification {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  headcount: number;
  tools_addons: string[];
  status: SpecStatus;
  daily_capacity: number | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type PricingRuleType = 'base' | 'tiered' | 'surcharge';

export interface PricingRule {
  id: string;
  spec_id: string;
  rule_type: PricingRuleType;
  base_price: number | null;
  tier_config: Record<string, unknown>[] | null;
  surcharge_label: string | null;
  surcharge_amount: number | null;
  created_at: Date;
}

export interface CapacityPlan {
  id: string;
  spec_id: string;
  date: string;
  max_volume: number;
  current_volume: number;
  is_stopped: boolean;
}

export type CreditChangeStatus = 'pending_approval' | 'approved' | 'rejected';

export interface CreditChange {
  id: string;
  entity_type: string;
  entity_id: string;
  amount: number;
  reason: string;
  requested_by: string;
  status: CreditChangeStatus;
  created_at: Date;
  updated_at: Date;
}

export type ApprovalMode = 'joint' | 'any';

export interface ApprovalTemplate {
  id: string;
  name: string;
  description: string | null;
  approval_mode: ApprovalMode;
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface ApprovalTemplateStep {
  id: string;
  template_id: string;
  step_order: number;
  approver_id: string;
  created_at: Date;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  id: string;
  template_id: string;
  entity_type: string;
  entity_id: string;
  requested_by: string;
  approval_mode: ApprovalMode;
  status: ApprovalStatus;
  final_write_back: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface ApprovalStep {
  id: string;
  request_id: string;
  step_order: number;
  approver_id: string;
  status: ApprovalStatus;
  comment: string | null;
  attachment_path: string | null;
  attachment_size: number | null;
  decided_at: Date | null;
  created_at: Date;
}

export type NotificationChannel = 'in_app' | 'email_export' | 'sms_export';
export type NotificationStatus = 'pending' | 'generated' | 'opened' | 'acknowledged' | 'failed';

export interface NotificationTemplate {
  id: string;
  template_key: string;
  subject: string;
  body: string;
  channel: NotificationChannel;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationTask {
  id: string;
  recipient_id: string;
  type: NotificationChannel;
  template_key: string;
  template_vars: Record<string, unknown>;
  rendered_content: string | null;
  status: NotificationStatus;
  retry_count: number;
  max_retries: number;
  export_path: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Comment {
  id: string;
  entity_type: string;
  entity_id: string;
  author_id: string;
  body: string;
  created_at: Date;
}

export type GeoSourceType = 'csv' | 'geojson' | 'gps';
export type ImportStatus = 'pending' | 'processing' | 'complete' | 'error';

export interface GeoDataset {
  id: string;
  name: string;
  source_type: GeoSourceType;
  file_path: string;
  import_status: ImportStatus;
  feature_count: number | null;
  bounds: Record<string, unknown> | null;
  created_at: Date;
}

export interface GeoFeature {
  id: string;
  dataset_id: string;
  geometry: unknown;
  properties: Record<string, unknown>;
}

export type MediaFormat = 'hls' | 'dash';

export interface MediaAsset {
  id: string;
  title: string;
  file_path: string;
  format: MediaFormat;
  duration_seconds: number | null;
  subtitle_paths: { lang: string; format: string; path: string }[];
  created_at: Date;
}

export interface PlaybackState {
  id: string;
  user_id: string;
  asset_id: string;
  position_seconds: number;
  playback_speed: number;
  selected_quality: string | null;
  updated_at: Date;
}

export interface AppCheckpoint {
  id: string;
  user_id: string;
  checkpoint_data: Record<string, unknown>;
  created_at: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
