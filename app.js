
       
      class ChunkedRenderer {
        constructor(container, data, renderItem) {
          this.container = container;
          this.data = data;
          this.renderItem = renderItem;
          this.batchSize = 100;
          this.rendered = 0;
          this.loading = false;
          // 数据集代数：搜索过滤 setData 换数据时 +1，用于让进行中的跳转失效，
          // 防止按旧下标滚动到错误消息；seekSeq 让后发起的跳转作废先前的跳转。
          this.dataGeneration = 0;
          this.seekSeq = 0;

          this.list = document.createElement('div');
          this.list.className = 'message-list';
          this.container.appendChild(this.list);

          this.sentinel = document.createElement('div');
          this.sentinel.className = 'load-sentinel';
          this.container.appendChild(this.sentinel);

          this.renderBatch();

          this.observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !this.loading) {
              this.renderBatch();
            }
          }, { root: this.container, rootMargin: '600px' });
          this.observer.observe(this.sentinel);
        }

        renderBatch() {
          if (this.rendered >= this.data.length) return;
          this.loading = true;
          const end = Math.min(this.rendered + this.batchSize, this.data.length);
          const fragment = document.createDocumentFragment();
          for (let i = this.rendered; i < end; i++) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = this.renderItem(this.data[i], i);
            if (wrapper.firstElementChild) fragment.appendChild(wrapper.firstElementChild);
          }
          this.list.appendChild(fragment);
          this.rendered = end;
          this.loading = false;
        }

        setData(newData) {
          this.dataGeneration += 1;
          this.data = newData;
          this.rendered = 0;
          this.list.innerHTML = '';
          this.container.scrollTop = 0;
          if (this.data.length === 0) {
            this.list.innerHTML = '<div class="empty">暂无消息</div>';
            return;
          }
          this.renderBatch();
        }

        findFirstIndexAtOrAfter(timestamp) {
          // 数据已按时间升序注入（见 HtmlFormatter），二分查找第一个 t >= timestamp 的下标
          let lo = 0;
          let hi = this.data.length - 1;
          let ans = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const t = Number(this.data[mid].t || 0);
            if (t >= timestamp) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
          }
          return ans;
        }

        ensureRenderedUpTo(idx, onProgress, generation) {
          // 分帧渲染到目标下标，避免大会话一次性同步渲染造成长时间冻结
          return new Promise((resolve) => {
            if (idx < this.rendered || this.rendered >= this.data.length ||
                (generation !== undefined && generation !== this.dataGeneration)) { resolve(); return; }
            const BATCHES_PER_FRAME = 20;
            const total = idx + 1;
            const tick = () => {
              if (this.rendered >= this.data.length || idx < this.rendered ||
                  (generation !== undefined && generation !== this.dataGeneration)) { resolve(); return; }
              for (let i = 0; i < BATCHES_PER_FRAME && this.rendered <= idx && this.rendered < this.data.length; i++) {
                this.renderBatch();
              }
              if (onProgress) onProgress(Math.min(this.rendered, total), total);
              if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
              else setTimeout(tick, 0);
            };
            tick();
          });
        }

        async scrollToTime(timestamp, onProgress) {
          const idx = this.findFirstIndexAtOrAfter(timestamp);
          if (idx === -1) return false;
          const generation = this.dataGeneration;
          const seekId = ++this.seekSeq;
          await this.ensureRenderedUpTo(idx, onProgress, generation);
          if (generation !== this.dataGeneration || seekId !== this.seekSeq) return false;
          const el = this.list.children[idx];
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight');
            setTimeout(() => el.classList.remove('highlight'), 2500);
          }
          return true;
        }

        async scrollToIndex(index) {
          if (index < 0 || index >= this.data.length) return false;
          const generation = this.dataGeneration;
          const seekId = ++this.seekSeq;
          await this.ensureRenderedUpTo(index, undefined, generation);
          if (generation !== this.dataGeneration || seekId !== this.seekSeq) return false;
          const el = this.list.children[index];
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return true;
        }
      }
    

      const searchInput = document.getElementById('searchInput')
      const timeInput = document.getElementById('timeInput')
      const jumpBtn = document.getElementById('jumpBtn')
      const resultCount = document.getElementById('resultCount')
      const imagePreview = document.getElementById('imagePreview')
      const imagePreviewTarget = document.getElementById('imagePreviewTarget')
      const container = document.getElementById('scrollContainer')
      let imageZoom = 1

      // Initial Data
      let allData = window.WEFLOW_DATA || [];
      let currentList = allData;

      // Render Item Function
      const renderItem = (item, index) => {
         const isSenderMe = item.s === 1;
         const platformIdAttr = item.p ? ` data-platform-message-id="${item.p}"` : '';
         const replyToAttr = item.r ? ` data-reply-to-message-id="${item.r}"` : '';
         return `
          <div class="message ${isSenderMe ? 'sent' : 'received'}" data-index="${item.i}"${platformIdAttr}${replyToAttr}>
            <div class="message-row">
              <div class="avatar">${item.a}</div>
              <div class="bubble">
                ${item.b}
              </div>
            </div>
          </div>
         `;
      };
      
      const renderer = new ChunkedRenderer(container, currentList, renderItem);

      const updateCount = () => {
        resultCount.textContent = `共 ${currentList.length} 条`
      }

      // Search Logic
      let searchTimeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          const keyword = searchInput.value.trim().toLowerCase();
          if (!keyword) {
            currentList = allData;
          } else {
            currentList = allData.filter(item => {
               return item.b.toLowerCase().includes(keyword); 
            });
          }
          renderer.setData(currentList);
          updateCount();
        }, 300);
      })

      // Jump Logic
      jumpBtn.addEventListener('click', async () => {
        const value = timeInput.value
        if (!value) return
        const parsed = new Date(value)
        if (isNaN(parsed.getTime())) return
        const target = Math.floor(parsed.getTime() / 1000)
        jumpBtn.disabled = true
        try {
          const found = await renderer.scrollToTime(target, (done, total) => {
            jumpBtn.textContent = total > 0 ? `跳转中 ${Math.floor((done / total) * 100)}%` : '跳转中...'
          })
          if (!found) {
            resultCount.textContent = '该时间之后没有消息'
            setTimeout(updateCount, 2500)
          }
        } finally {
          jumpBtn.disabled = false
          jumpBtn.textContent = '跳转'
        }
      })

      // Image Preview (Delegation)
      container.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('previewable')) {
           const full = target.getAttribute('data-full')
           if (!full) return
           imagePreviewTarget.src = full
           imageZoom = 1
           imagePreviewTarget.style.transform = 'scale(1)'
           imagePreview.classList.add('active')
        }
      });

      imagePreviewTarget.addEventListener('click', (event) => {
        event.stopPropagation()
      })

      imagePreviewTarget.addEventListener('dblclick', (event) => {
        event.stopPropagation()
        imageZoom = 1
        imagePreviewTarget.style.transform = 'scale(1)'
      })

      imagePreviewTarget.addEventListener('wheel', (event) => {
        event.preventDefault()
        const delta = event.deltaY > 0 ? -0.1 : 0.1
        imageZoom = Math.min(3, Math.max(0.5, imageZoom + delta))
        imagePreviewTarget.style.transform = `scale(${imageZoom})`
      }, { passive: false })

      imagePreview.addEventListener('click', () => {
        imagePreview.classList.remove('active')
        imagePreviewTarget.src = ''
        imageZoom = 1
        imagePreviewTarget.style.transform = 'scale(1)'
      })

      updateCount()
    