import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Form, Input, InputNumber, Modal, Space, Switch } from 'antd';
import { useStore } from '../store';

interface Props { open: boolean; onClose: () => void }

export default function SettingsModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const global = useStore((s) => s.config.global);
  const saveGlobal = useStore((s) => s.saveGlobal);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ registry: global.registry, builderName: global.builderName, tagTemplate: global.tagTemplate, concurrency: global.concurrency, failFast: global.failFast });
  }, [open, global, form]);

  const onOk = async () => {
    const v = await form.validateFields();
    const ok = await saveGlobal({ registry: v.registry.trim(), builderName: v.builderName.trim() || 'hr-builder', tagTemplate: v.tagTemplate.trim() || '{version}-{arch}-{time}', concurrency: Number(v.concurrency ?? 1), failFast: !!v.failFast });
    if (ok) { message.success(t('settings.saved')); onClose(); } else { message.warning(t('errors.saveBlocked')); }
  };

  return (
    <Modal open={open} title={t('settings.title')} onOk={onOk} onCancel={onClose} okText={t('common.save')} cancelText={t('common.cancel')} width={520} destroyOnClose>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="registry" label={t('settings.registry')}>
          <Input placeholder="harbor.example.com/hr" />
        </Form.Item>
        <Form.Item name="builderName" label={t('settings.builderName')}>
          <Input placeholder="hr-builder" />
        </Form.Item>
        <Form.Item name="tagTemplate" label={t('settings.tagTemplate')}>
          <Input placeholder="{version}-{arch}-{time}" />
        </Form.Item>
        <Space size={12}>
          <Form.Item name="concurrency" label={t('settings.concurrency')}>
            <InputNumber min={1} max={8} style={{ width: 72 }} />
          </Form.Item>
          <Form.Item name="failFast" label={t('settings.failFast')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}