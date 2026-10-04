# media-mcp

MCP server that wraps the AVCLabs hosted media services: video enhancement, image
enhancement / colorization / denoising, and SAM3 image segmentation. This context exists to
fix the vocabulary shared by the tool layer, the media-task pipeline, and the upload path.

## Language

### media operations

**Media host**:
A hosted AVCLabs service that accepts a media task. There are two: the enhancement host and
the SAM3 host, reached at different base URLs.
_Avoid_: endpoint, backend, environment

**Media task**:
One unit of work submitted to a media host, identified by a `task_id` and carrying a status of
`processing`, `completed`, or `failed`.
_Avoid_: job, request, job id

**Sync tool**:
A tool that submits a media task and waits for it before returning.
_Avoid_: blocking tool, foreground tool

**Async tool**:
A tool that submits a media task and returns the `task_id` immediately.
_Avoid_: background tool, queued tool

**Media task wait budget**:
The time a sync tool allows for observing a media task after receiving its `task_id`, including
status queries and the intervals between them. Media source preparation, uploading, and task
submission are outside this budget.
_Avoid_: tool execution limit, upload timeout

**Truncated wait**:
The outcome of a sync tool that stops observing a media task because its media task wait budget
or configured query-count limit is exhausted before a terminal state is observed. The caller
receives the `task_id` to keep polling; stopping observation does not cancel the media task.
_Avoid_: timeout, expiry

**Media source**:
Where the media a task operates on comes from — a publicly reachable URL, a local file path, or
base64 data.
_Avoid_: input, asset, payload

**Upload type**:
The switch that declares which kind of media source the caller supplied: `url` or `local`.
_Avoid_: source mode, input mode

### uploading local media

**Signature response**:
The data a media host's signature service returns to authorize exactly one object upload. The
two media hosts name and encode its fields differently.
_Avoid_: token, credential, upload ticket

**Storage form**:
The set of pre-signed fields that must accompany the object to storage, plus the URL that
receives it. It is what a signature response gets translated into.
_Avoid_: multipart body, upload params

**Signature adapter**:
The module that turns one media host's signature response into a storage form.
_Avoid_: signer, uploader, auth provider

**Upload module**:
The module that takes local media and returns a `file_id` by way of a signature adapter and a
storage form.
_Avoid_: TOS client, storage client, uploader

**file_id**:
A media host's identifier for one object that has already been uploaded to storage. It is what
a media task is created against.
_Avoid_: object key, upload id, filename

**Object key**:
The name the object will carry inside storage. It appears in the storage form and in the upload
URL, and it is *not* the same thing as a `file_id` even when the two strings look alike.
_Avoid_: file_id, path, filename
