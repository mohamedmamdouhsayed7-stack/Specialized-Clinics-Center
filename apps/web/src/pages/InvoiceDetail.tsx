import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { invoicesService, CreateReplacementDto } from '../services/invoices.service';
import { paymentsService, PaymentMethod } from '../services/payments.service';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../utils/dateFormat';
import { formatMoney, formatNumber, moneyToCents, normalizeMoneyInput } from '../utils/money';
import { getReturnTo } from '../utils/listState';
import { preserveListState } from '../utils/listState';
import { createInvoiceDocumentTitle, invoicePatientDisplayName } from '../utils/invoiceFilename';
import {
  buildWhatsAppUrl,
  canShareInvoiceFile,
  isValidWhatsAppPhone,
  normalizeWhatsAppPhone,
} from '../utils/invoiceSharing';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../contexts/ToastContext';
import PageHeader from '../components/PageHeader';
import Skeleton from '../components/Skeleton';
import {
  ChevronDown,
  Copy,
  Download,
  FileText,
  Link as LinkIcon,
  MessageCircle,
  Printer,
  Share2,
  Smartphone,
  X,
} from 'lucide-react';

export default function InvoiceDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = getReturnTo(searchParams.toString(), '/invoices');
  const { showToast } = useToast();

  const PAYMENT_METHOD_LABELS: Record<PaymentMethod | 'CASH' | 'VISA', string> = {
    KNET: t('payments.methodKnet'),
    LINK: t('payments.methodLink'),
    OTHER: 'OTHER',
    CASH: 'CASH',
    VISA: 'VISA',
  };

  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('KNET');
  const [issuePaymentMethod, setIssuePaymentMethod] = useState<PaymentMethod>('KNET');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: invoice, isLoading: invoiceLoading, error: invoiceError } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesService.getInvoice(id!),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => invoicesService.deleteInvoicePermanently(id!),
    onSuccess: () => {
      setConfirmDelete(false);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      showToast({ type: 'success', message: t('feedback.invoiceDeleted') });
      navigate(returnTo);
    },
    onError: (error: Error) => showToast({ type: 'error', message: error.message }),
  });

  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: ['payments', id],
    queryFn: () => paymentsService.getPaymentsForInvoice(id!),
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: (
      data: {
        status: 'ISSUED' | 'VOID';
        paymentMethod?: 'KNET' | 'LINK' | 'OTHER';
      }
    ) =>
      invoicesService.updateInvoiceStatus(
        id!,
        data.status,
        data.paymentMethod
      ),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      setConfirmStatus(null);
      setIssuePaymentMethod('KNET');
      showToast({
        type: 'success',
        message: t('feedback.invoiceStatusUpdated'),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const paymentMutation = useMutation({
    mutationFn: () =>
      paymentsService.createPayment({
        invoiceId: id!,
        amount: (moneyToCents(paymentAmount) || 0) / 100,
        method: paymentMethod,
        notes: paymentNotes || undefined,
      }),
    onSuccess: () => {
      setPaymentAmount('');
      setPaymentNotes('');
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['payments', id] });
      showToast({
        type: 'success',
        message: t('feedback.paymentRecorded'),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const reversePaymentMutation = useMutation({
    mutationFn: ({
      paymentId,
      reversalNotes,
    }: {
      paymentId: string;
      reversalNotes?: string;
    }) => paymentsService.reversePayment(paymentId, reversalNotes),
    onSuccess: () => {
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['payments', id] });
      setConfirmReversePayment(false);
      setPaymentToReverse(null);
      setReversalNotes('');
      showToast({
        type: 'success',
        message: t('feedback.paymentReversed'),
      });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const replacementMutation = useMutation({
    mutationFn: (replacementData: CreateReplacementDto) =>
      invoicesService.createReplacement(id!, replacementData),
    onSuccess: (newInvoice) => {
      setFormError(null);
      setConfirmReplacement(false);
      setShowReplacementForm(false);
      setIssuePaymentMethod('KNET');
      showToast({
        type: 'success',
        message: t('feedback.invoiceReplaced'),
      });
      navigate(
        `/invoices/${newInvoice.id}?returnTo=${encodeURIComponent(returnTo)}`
      );
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const [showReplacementForm, setShowReplacementForm] = useState(false);
  const [reversalNotes, setReversalNotes] = useState('');
  const [paymentToReverse, setPaymentToReverse] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<
    'ISSUED' | 'VOID' | null
  >(null);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [confirmReversePayment, setConfirmReversePayment] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const [whatsappOpening, setWhatsappOpening] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [shareActionPending, setShareActionPending] = useState(false);
  const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);

  const [messageShareChannel, setMessageShareChannel] = useState<'sms' | null>(null);
  const [messageSharePhone, setMessageSharePhone] = useState('');
  const [messageShareCountryCode, setMessageShareCountryCode] = useState('');
  const [messageShareMessage, setMessageShareMessage] = useState('');
  const [whatsappCountryCode, setWhatsappCountryCode] = useState('965');

  const shareMenuRef = useRef<HTMLDivElement>(null);
  const messageShareDialogRef = useRef<HTMLDivElement>(null);
  const whatsappModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareMenuOpen && !messageShareChannel && !whatsappModalOpen) return;

    const handlePointerDown = (event: { target: object | null }) => {
      const target = event.target as Node;

      if (
        shareMenuOpen &&
        !shareMenuRef.current?.contains(target)
      ) {
        setShareMenuOpen(false);
      }

      if (
        messageShareChannel &&
        !messageShareDialogRef.current?.contains(target)
      ) {
        setMessageShareChannel(null);
      }

      if (
        whatsappModalOpen &&
        !whatsappModalRef.current?.contains(target)
      ) {
        setWhatsappModalOpen(false);
      }
    };

    const handleKeyDown = (event: { key?: string }) => {
      if (event.key === 'Escape') {
        setShareMenuOpen(false);
        setMessageShareChannel(null);
        setWhatsappModalOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [messageShareChannel, shareMenuOpen, whatsappModalOpen]);

  const downloadInvoicePdf = async () => {
    setShareMenuOpen(false);
    setPdfLoading(true);

    try {
      const language = i18n.language.startsWith('ar') ? 'ar' : 'en';
      await invoicesService.downloadPdf(
        id!,
        language,
        invoicePatientDisplayName(invoice?.patient, language),
        invoice?.invoiceNumber || id!,
      );

      showToast({
        type: 'success',
        message: t('invoices.pdfDownloaded'),
      });
    } catch (error) {
      showToast({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : t('invoices.pdfDownloadFailed'),
      });
    } finally {
      setPdfLoading(false);
    }
  };

  const printInvoice = async () => {
    if (shareActionPending) return;

    setShareActionPending(true);
    setShareMenuOpen(false);

    const printWindow = window.open('', '_blank');

    if (!printWindow) {
      setShareActionPending(false);
      showToast({
        type: 'error',
        message: t('invoices.popupBlocked'),
      });
      return;
    }

    const language = i18n.language.startsWith('ar') ? 'ar' : 'en';
    printWindow.document.title = createInvoiceDocumentTitle(
      invoicePatientDisplayName(invoice?.patient, language),
      invoice?.invoiceNumber || id!,
    );
    printWindow.document.body.innerHTML = `<p style="font-family: sans-serif; padding: 2rem; text-align: center">${t(
      'invoices.printLoading'
    )}</p>`;

    try {
      const blob = await invoicesService.getPdfBlob(
        id!,
        language
      );

      const url = window.URL.createObjectURL(blob);
      printWindow.location.replace(url);

      showToast({
        type: 'success',
        message: t('invoices.printReady'),
      });

      window.setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 60_000);
    } catch (error) {
      printWindow.close();

      showToast({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : t('invoices.pdfDownloadFailed'),
      });
    } finally {
      setShareActionPending(false);
    }
  };

  // The invoice share message is always Arabic.
  const buildShareMessage = () => {
    const patientName = invoice?.patient.fullNameAr || '';
    const total = formatMoney(invoice?.total || 0, 'ar');
    const paid = formatMoney(invoice?.paid || 0, 'ar');
    const currency = 'د.ك';

    return `السلام عليكم: ${patientName}\n\nتم إصدار فاتورتك من مركز العيادات التخصصية.\nرقم الفاتورة: ${invoice?.invoiceNumber}\nالإجمالي: ${total} ${currency}\nالمدفوع: ${paid} ${currency}\nتم إرفاق الفاتورة بصيغة PDF.\nشكرًا لزيارتكم، ونتمنى لكم دوام الصحة والعافية.`;
  };

  const knownCountryCodes = [
    '965',
    '20',
    '966',
    '971',
    '974',
    '973',
    '968',
  ];

  const openMessageShareDialog = (
    channel: 'sms'
  ) => {
    setShareMenuOpen(false);
    setMessageShareChannel(channel);
    setMessageSharePhone(invoice?.patient.phone || '');
    setMessageShareCountryCode('');
    setMessageShareMessage(buildShareMessage());
  };

  const sendMessageShare = () => {
    if (
      !messageShareChannel ||
      shareActionPending
    ) {
      return;
    }

    const phone = normalizeWhatsAppPhone(
      messageSharePhone,
      messageShareCountryCode
    );

    const hasInternationalPrefix =
      messageSharePhone.trim().startsWith('+') ||
      messageSharePhone.trim().startsWith('00') ||
      knownCountryCodes.some(
        (code) =>
          phone.startsWith(code) &&
          phone.length >= code.length + 7
      );

    if (
      (!messageShareCountryCode && !hasInternationalPrefix) ||
      !isValidWhatsAppPhone(phone)
    ) {
      showToast({
        type: 'error',
        message: t('invoices.whatsappMissingPhone'),
      });
      return;
    }

    const message =
      messageShareMessage.trim() || buildShareMessage();

    setShareActionPending(true);

    const encodedMessage = encodeURIComponent(message);
    const language = i18n.language.startsWith('ar')
      ? 'ar'
      : 'en';

    void (async () => {
      try {
        showToast({
          type: 'info',
          message: t('invoices.preparingInvoice'),
        });

        const file = await invoicesService.getSharePdfFile(
          id!,
          language,
          invoicePatientDisplayName(invoice?.patient, language),
          invoice?.invoiceNumber || id!
        );

        showToast({
          type: 'info',
          message: t('invoices.invoiceReadyToShare'),
        });

        const shareData = {
          files: [file],
          text: message,
          title: t('invoices.shareInvoiceTitle'),
        };

        const shareNavigator =
          navigator as globalThis.Navigator & {
            share?: (
              data?: globalThis.ShareData
            ) => Promise<void>;
            canShare?: (
              data?: globalThis.ShareData
            ) => boolean;
          };

        if (shareNavigator.share && canShareInvoiceFile(file)) {
          await shareNavigator.share(shareData);

          setMessageShareChannel(null);

          showToast({
            type: 'success',
            message: t('invoices.invoiceShared'),
          });

          return;
        }

        const downloadUrl =
          window.URL.createObjectURL(file);

        const downloadAnchor =
          document.createElement('a');

        downloadAnchor.href = downloadUrl;
        downloadAnchor.download = file.name;

        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();

        window.setTimeout(() => {
          window.URL.revokeObjectURL(downloadUrl);
        }, 60_000);

        showToast({
          type: 'info',
          message: t(
            'invoices.pdfDownloadedAttachManually'
          ),
        });

        const url = `sms:${phone}?body=${encodedMessage}`;

        window.location.assign(url);
      } catch (error) {
        if (
          error instanceof globalThis.DOMException &&
          error.name === 'AbortError'
        ) {
          showToast({
            type: 'info',
            message: t('invoices.shareCancelled'),
          });
        } else {
          showToast({
            type: 'error',
            message:
              error instanceof Error
                ? error.message
                : t('invoices.pdfShareFailed'),
          });
        }
      } finally {
        setShareActionPending(false);
      }
    })();
  };

  const sendWhatsAppMessage = () => {
    if (!invoice || shareActionPending) return;

    const rawPhone = invoice.patient.phone || '';

    // Use the selected country code from the WhatsApp modal
    const normalizedPhone = rawPhone
      ? normalizeWhatsAppPhone(rawPhone, whatsappCountryCode)
      : '';

    const hasValidPhone =
      !!rawPhone &&
      isValidWhatsAppPhone(normalizedPhone);

    if (!hasValidPhone) {
      showToast({
        type: 'error',
        message: t('invoices.whatsappMissingPhone'),
      });
      return;
    }

    setWhatsappOpening(true);
    setShareActionPending(true);

    try {
      const message = buildShareMessage();

      const url = buildWhatsAppUrl(
        normalizedPhone,
        message
      );

      showToast({
        type: 'info',
        message: t('invoices.whatsappOpening'),
      });

      window.location.assign(url);
    } catch (error) {
      showToast({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : t('invoices.pdfShareFailed'),
      });
    } finally {
      setWhatsappOpening(false);
      setShareActionPending(false);
    }
  };

  const shareInvoicePdfOnWhatsApp = () => {
    if (!invoice || shareActionPending) return;

    setShareMenuOpen(false);
    setShareActionPending(true);

    void (async () => {
      try {
        const language = i18n.language.startsWith('ar')
          ? 'ar'
          : 'en';

        showToast({
          type: 'info',
          message: t('invoices.preparingInvoice'),
        });

        const file = await invoicesService.getSharePdfFile(
          id!,
          language,
          invoicePatientDisplayName(invoice.patient, language),
          invoice.invoiceNumber
        );

        if (navigator.share && canShareInvoiceFile(file)) {
          await navigator.share({
            files: [file],
          });

          showToast({
            type: 'success',
            message: t('invoices.invoiceShared'),
          });

          return;
        }

        const downloadUrl =
          window.URL.createObjectURL(file);

        const downloadAnchor =
          document.createElement('a');

        downloadAnchor.href = downloadUrl;
        downloadAnchor.download = file.name;

        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();

        window.setTimeout(() => {
          window.URL.revokeObjectURL(downloadUrl);
        }, 60_000);

        showToast({
          type: 'info',
          message: t(
            'invoices.pdfDownloadedAttachManually'
          ),
        });
      } catch (error) {
        if (
          error instanceof globalThis.DOMException &&
          error.name === 'AbortError'
        ) {
          showToast({
            type: 'info',
            message: t('invoices.shareCancelled'),
          });
        } else {
          showToast({
            type: 'error',
            message:
              error instanceof Error
                ? error.message
                : t('invoices.pdfShareFailed'),
          });
        }
      } finally {
        setShareActionPending(false);
      }
    })();
  };

  const shareViaWebShare = () => {
    if (shareActionPending || !invoice) return;

    setShareMenuOpen(false);
    setShareActionPending(true);

    void (async () => {
      try {
        const language = i18n.language.startsWith('ar')
          ? 'ar'
          : 'en';
        const message = buildShareMessage();

        const shareNavigator =
          navigator as globalThis.Navigator & {
            share?: (
              data?: globalThis.ShareData
            ) => Promise<void>;
            canShare?: (
              data?: globalThis.ShareData
            ) => boolean;
          };

        if (!shareNavigator.share) {
          showToast({
            type: 'error',
            message: t('invoices.pdfShareFailed'),
          });
          return;
        }

        showToast({
          type: 'info',
          message: t('invoices.preparingInvoice'),
        });

        const file = await invoicesService.getSharePdfFile(
          id!,
          language,
          invoicePatientDisplayName(invoice.patient, language),
          invoice.invoiceNumber
        );

        if (canShareInvoiceFile(file)) {
          await shareNavigator.share({
            title: t('invoices.shareInvoiceTitle'),
            text: message,
            files: [file],
          });
        } else {
          await shareNavigator.share({
            title: t('invoices.shareInvoiceTitle'),
            text: message,
          });
        }

        showToast({
          type: 'success',
          message: t('invoices.invoiceShared'),
        });
      } catch (error) {
        if (
          error instanceof globalThis.DOMException &&
          error.name === 'AbortError'
        ) {
          showToast({
            type: 'info',
            message: t('invoices.shareCancelled'),
          });
        } else {
          showToast({
            type: 'error',
            message:
              error instanceof Error
                ? error.message
                : t('invoices.pdfShareFailed'),
          });
        }
      } finally {
        setShareActionPending(false);
      }
    })();
  };

  const shareViaSms = () => {
    openMessageShareDialog('sms');
  };

  const copyInvoiceNumber = async () => {
    setShareMenuOpen(false);

    const invoiceNumber = invoice?.invoiceNumber;

    if (!invoiceNumber) {
      showToast({
        type: 'error',
        message: t('invoices.copyFailed'),
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(invoiceNumber);

      showToast({
        type: 'success',
        message: t('invoices.invoiceNumberCopied'),
      });
    } catch {
      showToast({
        type: 'error',
        message: t('invoices.copyFailed'),
      });
    }
  };

  const handleRecordPayment = (
    e: React.FormEvent
  ) => {
    e.preventDefault();
    setFormError(null);

    const cents = moneyToCents(
      normalizeMoneyInput(paymentAmount)
    );

    if (cents === null || cents <= 0) {
      setFormError(t('payments.enterValidAmount'));
      return;
    }

    paymentMutation.mutate();
  };

  if (invoiceLoading) {
    return (
      <div className="min-h-screen bg-[#F6F7FA]">
        <div className="container mx-auto px-4 py-8">
          <div className="ui-card p-6 space-y-3">
            <Skeleton className="h-8 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (invoiceError || !invoice) {
    return (
      <div className="page-container">
        <div
          className="ui-card p-6 text-center text-[#C4362B]"
          role="alert"
        >
          {t('invoices.loadError')}
        </div>
      </div>
    );
  }

  const statusLabels: Record<string, string> = {
    DRAFT: t('invoices.statusDraft'),
    ISSUED: t('invoices.statusIssued'),
    VOID: t('invoices.statusVoid'),
  };

  const paymentStatusLabels: Record<string, string> = {
    UNPAID: t('invoices.unpaid'),
    PARTIALLY_PAID: t('invoices.partiallyPaid'),
    PAID: t('invoices.paidInFull'),
  };

  const canRecordPayment =
    invoice.status === 'ISSUED' &&
    invoice.paymentStatus !== 'PAID';

  const remainingIsPaid =
    Number(invoice.remaining) <= 0;

  return (
    <div className="min-h-screen bg-[#F6F7FA]">
      <div className="container mx-auto max-w-3xl px-4 py-5 sm:py-8">
        <PageHeader
          title={invoice.invoiceNumber}
          breadcrumbs={[
            {
              label: t('sidebar.invoices'),
              href: returnTo,
            },
            {
              label: invoice.invoiceNumber,
            },
          ]}
          backTo={returnTo}
          actions={
            <div className="flex flex-wrap gap-2">
              {isAdmin && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="btn-danger-outline px-4 py-2"
                >
                  {t('invoices.deletePermanently')}
                </button>
              )}
              <button onClick={() => navigate(returnTo)} className="btn-primary px-4 py-2">
                {t('common.back')}
              </button>
            </div>
          }
        />
        <ConfirmDialog
          open={confirmDelete}
          title={t('invoices.deletePermanently')}
          message={t('invoices.deleteWarning')}
          confirmLabel={deleteMutation.isPending ? t('common.loading') : t('common.confirm')}
          cancelLabel={t('common.cancel')}
          destructive
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />

        {formError && (
          <div
            role="alert"
            aria-live="polite"
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4"
          >
            {formError}
          </div>
        )}

        {/* Header */}
        <div className="mb-6 overflow-visible rounded-2xl border border-[#DCE3EF] bg-white shadow-[0_12px_35px_rgba(16,47,99,0.08)]">
          <div className="h-2 rounded-t-2xl bg-[#111844]" />

          <div className="p-4 sm:p-6">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <img
                    src="/assets/logo.png"
                    alt=""
                    className="h-12 w-12 object-contain"
                  />

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4B5694]">
                      {t('invoices.clinicNameEn')}
                    </p>

                    <p className="text-lg font-bold text-[#111844]">
                      {t('invoices.clinicNameAr')}
                    </p>
                  </div>
                </div>

                <h1 className="text-2xl font-bold text-[#111844]">
                  {t('invoices.invoiceTitle')}{' '}
                  <span className="text-[#4B5694]">
                    {invoice.invoiceNumber}
                  </span>
                </h1>

                <Link
                  to={preserveListState(
                    `/patients/${invoice.patient.id}`,
                    {
                      pathname: `/invoices/${invoice.id}`,
                      search: '',
                    }
                  )}
                  className="text-gray-600 hover:text-[#111844] hover:underline"
                >
                  {invoice.patient.fullNameAr}
                </Link>

                {invoice.visit && (
                  <Link
                    to={preserveListState(
                      `/visits/${invoice.visit.id}`,
                      {
                        pathname: `/invoices/${invoice.id}`,
                        search: '',
                      }
                    )}
                    className="block text-sm text-[#4B5694] hover:underline mt-1"
                  >
                    {t('visits.detailsTitle')}
                  </Link>
                )}

                {(invoice.replacedByInvoiceId ||
                  invoice.replacedInvoiceId) && (
                    <div className="mt-2 text-sm">
                      {invoice.replacedByInvoiceId ? (
                        <button
                          onClick={() =>
                            navigate(
                              `/invoices/${invoice.replacedByInvoiceId}?returnTo=${encodeURIComponent(
                                returnTo
                              )}`
                            )
                          }
                          className="text-[#4B5694] hover:underline"
                        >
                          {t('invoices.replacementInvoice')}
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            navigate(
                              `/invoices/${invoice.replacedInvoiceId}?returnTo=${encodeURIComponent(
                                returnTo
                              )}`
                            )
                          }
                          className="text-[#4B5694] hover:underline"
                        >
                          {t('invoices.replacedInvoice')}
                        </button>
                      )}
                    </div>
                  )}
              </div>

              <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                {invoice.status === 'ISSUED' && isAdmin && (
                  <button
                    onClick={() =>
                      setShowReplacementForm(
                        !showReplacementForm
                      )
                    }
                    className="px-4 py-2 border border-[#4B5694] text-[#4B5694] rounded-md hover:bg-blue-50 transition-colors"
                  >
                    {t('invoices.createReplacement')}
                  </button>
                )}

                <div
                  className="relative"
                  ref={shareMenuRef}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShareMenuOpen(
                        (open) => !open
                      );
                    }}
                    aria-expanded={shareMenuOpen}
                    aria-haspopup="menu"
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#111844] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1a237e] focus:outline-none focus:ring-2 focus:ring-[#4B5694] focus:ring-offset-2 sm:w-auto"
                  >
                    <Share2 size={16} />
                    {t('invoices.share')}
                    <ChevronDown
                      size={15}
                      className={
                        shareMenuOpen
                          ? 'rotate-180 transition-transform'
                          : 'transition-transform'
                      }
                    />
                  </button>

                  {shareMenuOpen && (
                    <div
                      role="menu"
                      className="absolute end-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-visible rounded-xl border border-[#DCE3EF] bg-white p-2 text-sm shadow-[0_16px_40px_rgba(16,47,99,0.18)]"
                    >
                      <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-[#8991A6]">
                        {t('invoices.shareSection')}
                      </p>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShareMenuOpen(false);
                          setWhatsappModalOpen(true);
                        }}
                        disabled={
                          whatsappOpening ||
                          shareActionPending
                        }
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start font-medium transition hover:bg-[#F6F8FC] focus:bg-[#F6F8FC] focus:outline-none disabled:cursor-wait disabled:opacity-50 text-[#128C7E]"
                      >
                        <MessageCircle size={16} />

                        <span className="flex-1">
                          {whatsappOpening
                            ? t('invoices.whatsappOpening')
                            : t('invoices.sendViaWhatsApp')}
                        </span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={shareViaSms}
                        disabled={shareActionPending}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start font-medium transition hover:bg-[#F6F8FC] focus:bg-[#F6F8FC] focus:outline-none disabled:cursor-wait disabled:opacity-50 text-[#4B5694]"
                      >
                        <Smartphone size={16} />
                        {t('invoices.shareSms')}
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={shareViaWebShare}
                        disabled={shareActionPending}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start font-medium transition hover:bg-[#F6F8FC] focus:bg-[#F6F8FC] focus:outline-none disabled:cursor-wait disabled:opacity-50 text-[#102F63]"
                      >
                        <Share2 size={16} />
                        {t('invoices.webShare')}
                      </button>

                      <div className="my-1 border-t border-[#EEF1F6]" />

                      <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-[#8991A6]">
                        {t('invoices.exportSection')}
                      </p>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={downloadInvoicePdf}
                        disabled={
                          pdfLoading ||
                          shareActionPending
                        }
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start font-medium transition hover:bg-[#F6F8FC] focus:bg-[#F6F8FC] focus:outline-none disabled:cursor-wait disabled:opacity-50 text-[#173B78]"
                      >
                        <Download size={16} />

                        {pdfLoading
                          ? t('invoices.downloading')
                          : t('invoices.downloadPdf')}
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={printInvoice}
                        disabled={shareActionPending}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start font-medium transition hover:bg-[#F6F8FC] focus:bg-[#F6F8FC] focus:outline-none disabled:cursor-wait disabled:opacity-50 text-[#173B78]"
                      >
                        <Printer size={16} />
                        {t('invoices.printInvoice')}
                      </button>

                      <div className="my-1 border-t border-[#EEF1F6]" />

                      <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-[#8991A6]">
                        {t('invoices.copySection')}
                      </p>

                      <button
                        type="button"
                        role="menuitem"
                        disabled
                        title={t(
                          'invoices.invoiceLinkUnavailable'
                        )}
                        className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-start font-medium text-[#A8B0C0]"
                      >
                        <LinkIcon size={16} />
                        {t('invoices.copyInvoiceLink')}
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={copyInvoiceNumber}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start font-medium transition hover:bg-[#F6F8FC] focus:bg-[#F6F8FC] focus:outline-none text-[#4B5694]"
                      >
                        <Copy size={16} />
                        {t(
                          'invoices.copyInvoiceNumber'
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {invoice.status === 'DRAFT' && (
                  <button
                    onClick={() => {
                      // Check if invoice needs payment method
                      const remainingValue = Number(invoice.remaining);
                      if (remainingValue > 0) {
                        setConfirmStatus('ISSUED');
                      } else {
                        // No payment needed, can issue directly
                        statusMutation.mutate({ status: 'ISSUED' });
                      }
                    }}
                    disabled={statusMutation.isPending}
                    className="px-4 py-2 bg-[#111844] text-white rounded-md hover:bg-[#1a237e] transition-colors disabled:opacity-50"
                  >
                    {t('invoices.issueInvoice')}
                  </button>
                )}

                {invoice.status !== 'VOID' && isAdmin && (
                  <button
                    onClick={() =>
                      setConfirmStatus('VOID')
                    }
                    disabled={statusMutation.isPending}
                    className="px-4 py-2 border border-[#C4362B] text-[#C4362B] rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    {t('invoices.voidInvoice')}
                  </button>
                )}
              </div>
            </div>

            {messageShareChannel && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-[#111844]/40 p-4"
                role="presentation"
              >
                <div
                  ref={messageShareDialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="message-share-title"
                  className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#DCE3EF] bg-white p-5 shadow-[0_20px_60px_rgba(16,47,99,0.25)]"
                >
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h2
                        id="message-share-title"
                        className="text-xl font-bold text-[#111844]"
                      >
                        {t('invoices.shareSms')}
                      </h2>

                      <p className="mt-1 text-sm text-[#667085]">
                        {t(
                          'invoices.shareDialogHint'
                        )}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setMessageShareChannel(null)
                      }
                      className="rounded-lg px-2 py-1 text-xl text-[#667085] hover:bg-[#F6F8FC] focus:outline-none focus:ring-2 focus:ring-[#4B5694]"
                      aria-label={t(
                        'common.close'
                      )}
                    >
                      ×
                    </button>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-[#344054]">
                      {t(
                        'invoices.recipientPhone'
                      )}

                      <input
                        type="tel"
                        value={messageSharePhone}
                        onChange={(event) =>
                          setMessageSharePhone(
                            event.target.value
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-[#DCE3EF] px-3 py-2 font-normal text-[#1F2430] outline-none focus:border-[#4B5694] focus:ring-2 focus:ring-[#4B5694]/20"
                        dir="ltr"
                        autoFocus
                      />
                    </label>

                    <label className="mt-2 block text-sm font-semibold text-[#344054]">
                      {t(
                        'invoices.countryCode'
                      )}

                      <select
                        value={
                          messageShareCountryCode
                        }
                        onChange={(event) =>
                          setMessageShareCountryCode(
                            event.target.value
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-[#DCE3EF] px-3 py-2 font-normal text-[#1F2430] outline-none focus:border-[#4B5694] focus:ring-2 focus:ring-[#4B5694]/20"
                        dir="ltr"
                      >
                        <option value="">
                          {t(
                            'invoices.chooseCountryCode'
                          )}
                        </option>
                        <option value="965">
                          Kuwait (+965)
                        </option>
                        <option value="20">
                          Egypt (+20)
                        </option>
                        <option value="966">
                          Saudi Arabia (+966)
                        </option>
                        <option value="971">
                          United Arab Emirates (+971)
                        </option>
                        <option value="974">
                          Qatar (+974)
                        </option>
                        <option value="973">
                          Bahrain (+973)
                        </option>
                        <option value="968">
                          Oman (+968)
                        </option>
                      </select>
                    </label>
                  </div>

                  <label className="block text-sm font-semibold text-[#344054]">
                    {t('invoices.customMessage')}

                    <textarea
                      value={messageShareMessage}
                      onChange={(event) =>
                        setMessageShareMessage(
                          event.target.value
                        )
                      }
                      rows={5}
                      className="mt-1 w-full resize-y rounded-lg border border-[#DCE3EF] px-3 py-2 font-normal text-[#1F2430] outline-none focus:border-[#4B5694] focus:ring-2 focus:ring-[#4B5694]/20"
                    />
                  </label>

                  <div className="mt-4 rounded-xl bg-[#F6F8FC] p-3">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[#8991A6]">
                      {t(
                        'invoices.messagePreview'
                      )}
                    </p>

                    <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-[#344054]">
                      {messageShareMessage ||
                        buildShareMessage()}
                    </p>
                  </div>

                  <p className="mt-4 text-xs leading-5 text-[#667085]">
                    {t('invoices.smsLimitation')}
                  </p>

                  <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setMessageShareChannel(null)
                      }
                      className="rounded-lg border border-[#DCE3EF] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#F6F8FC] focus:outline-none focus:ring-2 focus:ring-[#4B5694]"
                    >
                      {t('common.cancel')}
                    </button>

                    <button
                      type="button"
                      onClick={sendMessageShare}
                      disabled={shareActionPending}
                      className="rounded-lg bg-[#111844] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1A237E] focus:outline-none focus:ring-2 focus:ring-[#4B5694] disabled:cursor-wait disabled:opacity-50"
                    >
                      {shareActionPending
                        ? t('invoices.sharing')
                        : t('invoices.sendSms')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 md:grid-cols-4">
              <div>
                <div className="text-gray-500">
                  {t('invoices.invoiceStatus')}
                </div>

                <div className="font-medium text-gray-900">
                  {statusLabels[invoice.status]}
                </div>
              </div>

              <div>
                <div className="text-gray-500">
                  {t(
                    'invoices.paymentStatusLabel'
                  )}
                </div>

                <div className="font-medium text-gray-900">
                  {
                    paymentStatusLabels[
                    invoice.paymentStatus
                    ]
                  }
                </div>
              </div>

              <div>
                <div className="text-gray-500">
                  {t('invoices.createdDate')}
                </div>

                <div className="font-medium text-gray-900">
                  {formatDateTime(
                    invoice.createdAt,
                    i18n.language
                  )}
                </div>
              </div>

              {invoice.issuedAt && (
                <div>
                  <div className="text-gray-500">
                    {t('invoices.issuedDate')}
                  </div>

                  <div className="font-medium text-gray-900">
                    {formatDateTime(
                      invoice.issuedAt,
                      i18n.language
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-3 rounded-xl bg-[#F6F8FC] p-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-[#64748B]">
                  {t('invoices.doctor')}
                </span>

                <p className="font-semibold text-[#111844]">
                  {t('invoices.doctorName')}
                </p>
              </div>

              <div>
                <span className="text-[#64748B]">
                  {t('invoices.contact')}
                </span>

                <p className="font-semibold text-[#111844]">
                  22650700 · 60008977
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="mb-6 overflow-hidden rounded-2xl border border-[#DCE3EF] bg-white shadow-[0_12px_35px_rgba(16,47,99,0.06)]">
          <div className="flex items-center gap-2 border-b border-[#E6EBF2] px-4 py-4 sm:px-6">
            <FileText
              size={18}
              className="text-[#4B5694]"
            />

            <h2 className="font-bold text-[#111844]">
              {t('invoices.invoiceItems')}
            </h2>
          </div>

          <div className="mobile-record-list p-3 md:hidden">
            {invoice.invoiceItems.map((item) => (
              <div
                key={item.id}
                className="ui-card p-4"
              >
                <div className="font-medium text-gray-900">
                  {item.serviceNameSnapshot}
                </div>

                <div className="mt-2 grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {t('services.price')}
                    </span>

                    <span>
                      {formatMoney(
                        item.unitPriceSnapshot,
                        i18n.language
                      )}{' '}
                      {t('common.currency')}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {t('invoices.quantity')}
                    </span>

                    <span>
                      {formatNumber(
                        item.quantity,
                        i18n.language
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between font-medium">
                    <span className="text-gray-500">
                      {t('invoices.total')}
                    </span>

                    <span>
                      {formatMoney(
                        item.lineTotal,
                        i18n.language
                      )}{' '}
                      {t('common.currency')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                    {t('invoices.service')}
                  </th>

                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                    {t('services.price')}
                  </th>

                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                    {t('invoices.quantity')}
                  </th>

                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                    {t('invoices.total')}
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {invoice.invoiceItems.map(
                  (item) => (
                    <tr key={item.id}>
                      <td className="px-6 py-4 text-gray-900">
                        {item.serviceNameSnapshot}
                      </td>

                      <td className="px-6 py-4 text-gray-700">
                        {formatMoney(
                          item.unitPriceSnapshot,
                          i18n.language
                        )}{' '}
                        {t('common.currency')}
                      </td>

                      <td className="px-6 py-4 text-gray-700">
                        {formatNumber(
                          item.quantity,
                          i18n.language
                        )}
                      </td>

                      <td className="px-6 py-4 text-gray-900 font-medium">
                        {formatMoney(
                          item.lineTotal,
                          i18n.language
                        )}{' '}
                        {t('common.currency')}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-gray-200 p-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">
                {t('invoices.subtotal')}
              </span>

              <span className="text-gray-900">
                {formatMoney(
                  invoice.subtotal,
                  i18n.language
                )}{' '}
                {t('common.currency')}
              </span>
            </div>

            {invoice.additionalCharges &&
              invoice.additionalCharges.length >
              0 &&
              invoice.additionalCharges.map(
                (charge) => (
                  <div
                    key={charge.id}
                    className="flex justify-between"
                  >
                    <span className="text-gray-600">
                      {charge.description ||
                        (charge.chargeType ===
                          'PERCENTAGE'
                          ? t(
                            'invoices.percentageCharge'
                          )
                          : t(
                            'invoices.fixedCharge'
                          ))}{' '}
                      (
                      {charge.chargeType ===
                        'PERCENTAGE'
                        ? `${charge.chargeValue}%`
                        : `${formatMoney(
                          charge.chargeValue,
                          i18n.language
                        )} ${t(
                          'common.currency'
                        )}`}
                      )
                    </span>

                    <span className="text-gray-900">
                      {formatMoney(
                        charge.calculatedAmount,
                        i18n.language
                      )}{' '}
                      {t('common.currency')}
                    </span>
                  </div>
                )
              )}

            <div className="flex justify-between">
              <span className="text-gray-600">
                {t('invoices.total')}
              </span>

              <span className="font-bold text-[#111844]">
                {formatMoney(
                  invoice.total,
                  i18n.language
                )}{' '}
                {t('common.currency')}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-600">
                {t('invoices.paid')}
              </span>

              <span className="text-gray-900">
                {formatMoney(
                  invoice.paid,
                  i18n.language
                )}{' '}
                {t('common.currency')}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-600">
                {t('invoices.remaining')}
              </span>

              <span
                className={`font-bold ${remainingIsPaid
                  ? 'text-[var(--success)]'
                  : 'text-[#C4362B]'
                  }`}
              >
                {formatMoney(
                  invoice.remaining,
                  i18n.language
                )}{' '}
                {t('common.currency')}
              </span>
            </div>

            {/* Payment Method - show from latest payment or allocation */}
            {payments && payments.length > 0 ? (
              <div className="flex justify-between">
                <span className="text-gray-600">
                  {t('invoices.paymentMethod')}
                </span>

                <span className="text-gray-900">
                  {PAYMENT_METHOD_LABELS[payments[0].method]}
                </span>
              </div>
            ) : invoice.paymentStatus === 'PAID' ? (
              <div className="flex justify-between">
                <span className="text-gray-600">
                  {t('invoices.paymentMethod')}
                </span>

                <span className="text-gray-900">
                  {t('invoices.paidViaAllocation')}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Invoice Replacement Form - Admin Only */}
        {showReplacementForm && isAdmin && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-lg font-bold text-[#111844] mb-4">
              {t(
                'invoices.createReplacementTitle'
              )}
            </h2>

            <p className="text-sm text-gray-600 mb-4">
              {t('invoices.replacementNote')}
            </p>

            {Number(invoice.remaining) > 0 && (
              <div className="mb-4 p-4 bg-[#F8FBFF] border border-[#DCE3EE] rounded-lg">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('invoices.paymentMethod')}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="replacementPaymentMethod"
                      value="KNET"
                      checked={issuePaymentMethod === 'KNET'}
                      onChange={(e) => setIssuePaymentMethod(e.target.value as PaymentMethod)}
                      className="w-4 h-4 text-[#111844] focus:ring-[#111844]"
                    />
                    <span className="text-gray-900">KNET</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="replacementPaymentMethod"
                      value="LINK"
                      checked={issuePaymentMethod === 'LINK'}
                      onChange={(e) => setIssuePaymentMethod(e.target.value as PaymentMethod)}
                      className="w-4 h-4 text-[#111844] focus:ring-[#111844]"
                    />
                    <span className="text-gray-900">LINK</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="replacementPaymentMethod"
                      value="OTHER"
                      checked={issuePaymentMethod === 'OTHER'}
                      onChange={(e) => setIssuePaymentMethod(e.target.value as PaymentMethod)}
                      className="w-4 h-4 text-[#111844] focus:ring-[#111844]"
                    />
                    <span className="text-gray-900">OTHER</span>
                  </label>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {t('invoices.remaining')}: {formatMoney(invoice.remaining, i18n.language)} {t('common.currency')}
                </p>
              </div>
            )}

            <button
              onClick={() =>
                setConfirmReplacement(true)
              }
              disabled={
                replacementMutation.isPending
              }
              className="px-4 py-2 bg-[#111844] text-white rounded-md hover:bg-[#1a237e] transition-colors disabled:opacity-50"
            >
              {replacementMutation.isPending
                ? t('invoices.creating')
                : t(
                  'invoices.createReplacementBtn'
                )}
            </button>

            <button
              onClick={() =>
                setShowReplacementForm(false)
              }
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 mr-2"
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        {/* Record Payment */}
        {canRecordPayment && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-lg font-bold text-[#111844] mb-4">
              {t('payments.recordPayment')}
            </h2>

            <div
              id="payment-amount-guidance"
              className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-[#173B78]"
            >
              <span className="font-semibold">
                {t('invoices.remaining')}:
              </span>{' '}
              {formatMoney(
                invoice.remaining,
                i18n.language
              )}{' '}
              {t('common.currency')}

              <span className="mx-1">·</span>

              {t(
                'payments.amountGuidance'
              )}
            </div>

            <form
              onSubmit={handleRecordPayment}
              className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
            >
              <div className="flex-1 min-w-[120px]">
                <label className="block text-sm text-gray-600 mb-1">
                  {t('payments.amount')}
                </label>

                <input
                  type="text"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={paymentAmount}
                  onChange={(e) =>
                    setPaymentAmount(
                      e.target.value
                    )
                  }
                  aria-describedby="payment-amount-guidance"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844]"
                  required
                />
              </div>

              <div className="flex-1 min-w-[140px]">
                <label className="block text-sm text-gray-600 mb-1">
                  {t('payments.method')}
                </label>

                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(
                      e.target.value as PaymentMethod
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844]"
                >
                  <option value="KNET">KNET</option>
                  <option value="LINK">LINK</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </div>

              <div className="flex-1 min-w-[160px]">
                <label className="block text-sm text-gray-600 mb-1">
                  {t(
                    'payments.notesOptional'
                  )}
                </label>

                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) =>
                    setPaymentNotes(
                      e.target.value
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#111844]"
                />
              </div>

              <button
                type="submit"
                disabled={
                  paymentMutation.isPending
                }
                className="px-4 py-2 bg-[#111844] text-white rounded-md hover:bg-[#1a237e] transition-colors disabled:opacity-50"
              >
                {paymentMutation.isPending
                  ? t('payments.recording')
                  : t(
                    'payments.recordPaymentBtn'
                  )}
              </button>
            </form>
          </div>
        )}

        {/* Payment History */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-[#111844]">
              {t('payments.history')}
            </h2>
          </div>

          {paymentsLoading ? (
            <div className="p-6 text-gray-500">
              {t('common.loading')}
            </div>
          ) : !payments?.length ? (
            <div className="p-6 text-center text-gray-500">
              {t('payments.noPayments')}
            </div>
          ) : (
            <>
              <div className="mobile-record-list p-3 md:hidden">
                {payments?.map((payment) => (
                  <div
                    key={payment.id}
                    className="ui-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-gray-900">
                        {formatMoney(
                          payment.amount,
                          i18n.language
                        )}{' '}
                        {t(
                          'common.currency'
                        )}
                      </span>

                      <span className="text-sm text-gray-600">
                        {
                          PAYMENT_METHOD_LABELS[
                          payment.method
                          ]
                        }
                      </span>
                    </div>

                    <div className="mt-2 grid gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">
                          {t('common.date')}
                        </span>

                        <span>
                          {formatDateTime(
                            payment.paymentDate,
                            i18n.language
                          )}
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-gray-500">
                          {t(
                            'payments.recordedBy'
                          )}
                        </span>

                        <span>
                          {payment.recordedBy
                            ?.name || '—'}
                        </span>
                      </div>

                      {isAdmin && (
                        <button
                          onClick={() =>
                            setPaymentToReverse(
                              payment.id
                            )
                          }
                          className="text-right text-sm text-[#C4362B]"
                        >
                          {t(
                            'payments.reversePayment'
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                        {t('payments.amount')}
                      </th>

                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                        {t('payments.method')}
                      </th>

                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                        {t('common.date')}
                      </th>

                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">
                        {t(
                          'payments.recordedBy'
                        )}
                      </th>

                      {isAdmin && (
                        <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700" />
                      )}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-200">
                    {payments?.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-6 py-4 text-gray-900 font-medium">
                          {formatMoney(
                            payment.amount,
                            i18n.language
                          )}{' '}
                          {t(
                            'common.currency'
                          )}
                        </td>

                        <td className="px-6 py-4 text-gray-700">
                          {
                            PAYMENT_METHOD_LABELS[
                            payment.method
                            ]
                          }
                        </td>

                        <td className="px-6 py-4 text-gray-600">
                          {formatDateTime(
                            payment.paymentDate,
                            i18n.language
                          )}
                        </td>

                        <td className="px-6 py-4 text-gray-600">
                          {payment.recordedBy
                            ?.name || '—'}
                        </td>

                        {isAdmin && (
                          <td className="px-6 py-4">
                            {paymentToReverse ===
                              payment.id ? (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder={t(
                                    'payments.reversalReasonPlaceholder'
                                  )}
                                  value={
                                    reversalNotes
                                  }
                                  onChange={(e) =>
                                    setReversalNotes(
                                      e.target.value
                                    )
                                  }
                                  className="px-2 py-1 border border-gray-300 rounded text-sm w-32"
                                />

                                <button
                                  onClick={() =>
                                    setConfirmReversePayment(
                                      true
                                    )
                                  }
                                  className="text-[#C4362B] hover:text-[#a32b22] text-sm font-medium"
                                >
                                  {t(
                                    'payments.confirmReversal'
                                  )}
                                </button>

                                <button
                                  onClick={() => {
                                    setPaymentToReverse(
                                      null
                                    );
                                    setReversalNotes(
                                      ''
                                    );
                                  }}
                                  className="text-gray-600 hover:text-gray-900 text-sm"
                                >
                                  {t(
                                    'common.cancel'
                                  )}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() =>
                                  setPaymentToReverse(
                                    payment.id
                                  )
                                }
                                className="text-[#C4362B] hover:text-[#a32b22] text-sm"
                              >
                                {t(
                                  'payments.reversePayment'
                                )}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <ConfirmDialog
          open={!!confirmStatus}
          title={
            confirmStatus === 'ISSUED'
              ? t('invoices.issueInvoice')
              : t('invoices.voidInvoice')
          }
          message={
            confirmStatus === 'ISSUED'
              ? Number(invoice.remaining) > 0
                ? `${t('invoices.issueConfirm')} ${t('invoices.remaining')}: ${formatMoney(invoice.remaining, i18n.language)} ${t('common.currency')}`
                : t('invoices.issueConfirm')
              : t('invoices.voidConfirm')
          }
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
          destructive={
            confirmStatus === 'VOID'
          }
          loading={statusMutation.isPending}
          onCancel={() =>
            setConfirmStatus(null)
          }
          onConfirm={() => {
            if (confirmStatus === 'ISSUED') {
              if (Number(invoice.remaining) > 0) {
                statusMutation.mutate({ status: 'ISSUED', paymentMethod: issuePaymentMethod });
              } else {
                statusMutation.mutate({ status: 'ISSUED' });
              }
            } else if (confirmStatus === 'VOID') {
              statusMutation.mutate({ status: 'VOID' });
            }
          }}
        >
          {confirmStatus === 'ISSUED' && Number(invoice.remaining) > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                {t('invoices.paymentMethod')}
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="issuePaymentMethod"
                    value="KNET"
                    checked={issuePaymentMethod === 'KNET'}
                    onChange={(e) => setIssuePaymentMethod(e.target.value as PaymentMethod)}
                    className="w-4 h-4 text-[#111844] focus:ring-[#111844]"
                  />
                  <span className="text-gray-900">KNET</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="issuePaymentMethod"
                    value="LINK"
                    checked={issuePaymentMethod === 'LINK'}
                    onChange={(e) => setIssuePaymentMethod(e.target.value as PaymentMethod)}
                    className="w-4 h-4 text-[#111844] focus:ring-[#111844]"
                  />
                  <span className="text-gray-900">LINK</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="issuePaymentMethod"
                    value="OTHER"
                    checked={issuePaymentMethod === 'OTHER'}
                    onChange={(e) => setIssuePaymentMethod(e.target.value as PaymentMethod)}
                    className="w-4 h-4 text-[#111844] focus:ring-[#111844]"
                  />
                  <span className="text-gray-900">OTHER</span>
                </label>
              </div>
            </div>
          )}
        </ConfirmDialog>

        <ConfirmDialog
          open={confirmReplacement}
          title={t(
            'invoices.createReplacementTitle'
          )}
          message={t(
            'invoices.replacementConfirm'
          )}
          confirmLabel={t(
            'invoices.createReplacementBtn'
          )}
          cancelLabel={t('common.cancel')}
          destructive
          loading={
            replacementMutation.isPending
          }
          onCancel={() =>
            setConfirmReplacement(false)
          }
          onConfirm={() => {
            const replacementItems =
              invoice.invoiceItems.map(
                (item) => ({
                  serviceId: item.serviceId,
                  quantity: item.quantity,
                  unitPrice: parseFloat(
                    item.unitPriceSnapshot
                  ),
                })
              );

            replacementMutation.mutate({
              items: replacementItems,
              additionalCharges:
                invoice.additionalCharges?.map(
                  (charge) => ({
                    chargeType:
                      charge.chargeType,
                    chargeValue: parseFloat(
                      charge.chargeValue
                    ),
                    description:
                      charge.description ||
                      undefined,
                  })
                ) || [],
              paymentMethod: Number(invoice.remaining) > 0 ? issuePaymentMethod : undefined,
            });
          }}
        />

        <ConfirmDialog
          open={
            confirmReversePayment &&
            !!paymentToReverse
          }
          title={t(
            'payments.reversePayment'
          )}
          message={t(
            'payments.reverseConfirm'
          )}
          confirmLabel={t(
            'payments.confirmReversal'
          )}
          cancelLabel={t('common.cancel')}
          destructive
          loading={
            reversePaymentMutation.isPending
          }
          onCancel={() =>
            setConfirmReversePayment(false)
          }
          onConfirm={() => {
            if (paymentToReverse) {
              reversePaymentMutation.mutate({
                paymentId:
                  paymentToReverse,
                reversalNotes:
                  reversalNotes || undefined,
              });
            }
          }}
        />

        {/* WhatsApp Mobile Modal */}
        {whatsappModalOpen && (
          <div
            ref={whatsappModalRef}
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
            style={{ maxHeight: '90dvh' }}
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setWhatsappModalOpen(false)}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90dvh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  {t('invoices.shareWhatsApp')}
                </h3>
                <button
                  type="button"
                  onClick={() => setWhatsappModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Country Code Selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('invoices.countryCode')}
                  </label>
                  <select
                    value={whatsappCountryCode}
                    onChange={(event) => setWhatsappCountryCode(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    dir="ltr"
                  >
                    <option value="965">Kuwait (+965)</option>
                    <option value="20">Egypt (+20)</option>
                    <option value="966">Saudi Arabia (+966)</option>
                    <option value="971">United Arab Emirates (+971)</option>
                    <option value="974">Qatar (+974)</option>
                    <option value="973">Bahrain (+973)</option>
                    <option value="968">Oman (+968)</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setWhatsappModalOpen(false);
                    sendWhatsAppMessage();
                  }}
                  disabled={shareActionPending}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#128C7E]/10 flex items-center justify-center">
                    <MessageCircle size={24} className="text-[#128C7E]" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-gray-900">
                      {t('invoices.sendViaWhatsApp')}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setWhatsappModalOpen(false);
                    shareInvoicePdfOnWhatsApp();
                  }}
                  disabled={shareActionPending}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[#173B78]/10 flex items-center justify-center">
                    <FileText size={24} className="text-[#173B78]" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-gray-900">
                      {t('invoices.sendInvoicePdf')}
                    </div>
                  </div>
                </button>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setWhatsappModalOpen(false)}
                  className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
